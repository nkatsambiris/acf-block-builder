<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACF_Block_Builder_Meta_Boxes {

	public function __construct() {
		add_action( 'add_meta_boxes', array( $this, 'add_meta_boxes' ) );
		add_action( 'save_post', array( $this, 'save_post' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_scripts' ) );
		add_action( 'wp_ajax_acf_block_builder_export_zip', array( $this, 'handle_export_zip' ) );
		add_action( 'wp_ajax_acf_block_builder_export_plugin', array( $this, 'handle_export_plugin' ) );
		add_action( 'wp_ajax_acf_block_builder_export_theme', array( $this, 'handle_export_theme' ) );

		// Admin Columns
		add_filter( 'manage_acf_block_builder_posts_columns', array( $this, 'add_active_column' ) );
		add_action( 'manage_acf_block_builder_posts_custom_column', array( $this, 'render_active_column' ), 10, 2 );
		add_action( 'wp_ajax_acf_block_builder_toggle_active', array( $this, 'handle_toggle_active' ) );
		add_action( 'wp_ajax_acf_block_builder_sync_back', array( $this, 'handle_sync_back' ) );
	}

	public function handle_sync_back() {
		check_ajax_referer( 'acf_block_builder_export', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
		if ( ! $post_id ) {
			wp_send_json_error( 'Invalid Post ID.' );
		}

		$block_slug = get_post_field( 'post_name', $post_id );
		$upload_dir = wp_upload_dir();
		$block_dir  = $upload_dir['basedir'] . '/acf-blocks/' . $block_slug;

		if ( ! file_exists( $block_dir ) ) {
			wp_send_json_error( 'Block directory not found.' );
		}

		// Find JSON file
		$files = glob( $block_dir . '/*.json' );
		// Exclude block.json
		$json_files = array_filter( $files, function( $file ) {
			return basename( $file ) !== 'block.json';
		} );

		if ( empty( $json_files ) ) {
			wp_send_json_error( 'No ACF JSON file found.' );
		}

		// Use the first one found (should be only one group per block ideally)
		$json_file = reset( $json_files );
		$json_content = file_get_contents( $json_file );
		$group = json_decode( $json_content, true );

		if ( ! $group ) {
			wp_send_json_error( 'Invalid JSON content.' );
		}

		// Convert to PHP
		$export = var_export( $group, true );
		$php_content = "<?php\nif( function_exists('acf_add_local_field_group') ):\n\nacf_add_local_field_group(" . $export . ");\n\nendif;";

		// Update Meta
		update_post_meta( $post_id, '_acf_block_builder_fields', $php_content );
		
		// Regenerate files
		$this->generate_block_files( $post_id );

		wp_send_json_success( 'Fields imported successfully. Reloading...' );
	}

	public function add_active_column( $columns ) {
		$new_columns = array();
		foreach ( $columns as $key => $value ) {
			if ( $key === 'date' ) {
				$new_columns['active_status'] = __( 'Status', 'acf-block-builder' );
			}
			$new_columns[ $key ] = $value;
		}
		if ( ! isset( $new_columns['active_status'] ) ) {
			$new_columns['active_status'] = __( 'Status', 'acf-block-builder' );
		}
		return $new_columns;
	}

	public function render_active_column( $column, $post_id ) {
		if ( 'active_status' === $column ) {
			$is_active = get_post_meta( $post_id, '_acf_block_builder_active', true );
			if ( '' === $is_active ) {
				$is_active = '1';
			}
			
			?>
			<label class="acf-bb-toggle-switch list-toggle" data-post-id="<?php echo esc_attr( $post_id ); ?>">
				<input type="checkbox" <?php checked( $is_active, '1' ); ?>>
				<span class="slider round"></span>
			</label>
			<?php
		}
	}

	public function handle_toggle_active() {
		check_ajax_referer( 'acf_block_builder_toggle', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
		$status  = isset( $_POST['status'] ) ? sanitize_text_field( $_POST['status'] ) : '0';

		if ( ! $post_id ) {
			wp_send_json_error( 'Invalid Post ID.' );
		}

		update_post_meta( $post_id, '_acf_block_builder_active', $status );
		wp_send_json_success();
	}

	public function add_meta_boxes() {
		add_meta_box(
			'acf_block_builder_editor',
			__( 'AI Block Builder', 'acf-block-builder' ),
			array( $this, 'render_chat_meta_box' ),
			'acf_block_builder',
			'normal',
			'high'
		);

		add_meta_box(
			'acf_block_builder_code',
			__( 'Code Editor', 'acf-block-builder' ),
			array( $this, 'render_code_meta_box' ),
			'acf_block_builder',
			'normal',
			'high'
		);

		add_meta_box(
			'acf_block_builder_fields_preview',
			__( 'Fields Overview', 'acf-block-builder' ),
			array( $this, 'render_fields_preview_meta_box' ),
			'acf_block_builder',
			'normal',
			'default'
		);

		add_meta_box(
			'acf_block_builder_actions',
			__( 'Actions', 'acf-block-builder' ),
			array( $this, 'render_actions_meta_box' ),
			'acf_block_builder',
			'side',
			'high'
		);
	}

	public function render_actions_meta_box( $post ) {
		$block_slug = get_post_field( 'post_name', $post->ID );
		$is_active  = get_post_meta( $post->ID, '_acf_block_builder_active', true );
		$is_json_sync = get_post_meta( $post->ID, '_acf_block_builder_json_sync', true );
		
		// Default to active if not set
		if ( '' === $is_active ) {
			$is_active = '1';
		}
		?>
		<div class="acf-bb-sidebar-actions">
			<div class="acf-bb-status-toggle" style="margin-top: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #ddd;">
				<label for="acf_block_builder_active" style="display: flex; align-items: center; cursor: pointer; justify-content: space-between;">
					<span style="font-weight: 600;"><?php _e( 'Block Status', 'acf-block-builder' ); ?></span>
					<div class="acf-bb-toggle-switch">
						<input type="checkbox" id="acf_block_builder_active" name="acf_block_builder_active" value="1" <?php checked( $is_active, '1' ); ?>>
						<span class="slider round"></span>
					</div>
				</label>
				<p class="description"><?php _e( 'Toggle to enable or disable this block.', 'acf-block-builder' ); ?></p>
			</div>

			<div class="acf-bb-status-toggle" style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #ddd;">
				<label for="acf_block_builder_json_sync" style="display: flex; align-items: center; cursor: pointer; justify-content: space-between;">
					<span style="font-weight: 600;"><?php _e( 'ACF JSON Sync', 'acf-block-builder' ); ?></span>
					<div class="acf-bb-toggle-switch">
						<input type="checkbox" id="acf_block_builder_json_sync" name="acf_block_builder_json_sync" value="1" <?php checked( $is_json_sync, '1' ); ?>>
						<span class="slider round"></span>
					</div>
				</label>
				<p class="description"><?php _e( 'Enable to edit fields in ACF GUI. Disables internal field registration.', 'acf-block-builder' ); ?></p>
				
				<div id="acf-bb-json-actions" style="margin-top: 10px; <?php echo $is_json_sync ? '' : 'display: none;'; ?>">
					<button type="button" id="acf-block-builder-sync-back" class="button button-secondary button-small" style="width: 100%;" data-post-id="<?php echo esc_attr( $post->ID ); ?>">
						<span class="dashicons dashicons-update"></span> <?php _e( 'Import from ACF JSON', 'acf-block-builder' ); ?>
					</button>
					<p class="description" style="font-size: 11px; margin-top: 5px;">
						<?php _e( 'Overwrites "fields.php" with changes made in ACF GUI.', 'acf-block-builder' ); ?>
					</p>
				</div>
			</div>

			<?php if ( ! empty( $block_slug ) ) : ?>
				<button type="button" id="acf-block-builder-export" class="button button-secondary button-large" style="width: 100%; justify-content: center; display: flex; align-items: center; gap: 5px;" data-post-id="<?php echo esc_attr( $post->ID ); ?>">
					<span class="dashicons dashicons-download"></span> <?php _e( 'Export to ZIP', 'acf-block-builder' ); ?>
				</button>
				<p class="description" style="margin-top: 10px;">
					<?php _e( 'Download a .zip file containing all block files (JSON, PHP, CSS, JS).', 'acf-block-builder' ); ?>
				</p>
				<button type="button" id="acf-block-builder-export-plugin" class="button button-secondary button-large" style="width: 100%; justify-content: center; display: flex; align-items: center; gap: 5px; margin-top: 15px;" data-post-id="<?php echo esc_attr( $post->ID ); ?>">
					<span class="dashicons dashicons-admin-plugins"></span> <?php _e( 'Export as Plugin', 'acf-block-builder' ); ?>
				</button>
				<p class="description" style="margin-top: 10px;">
					<?php _e( 'Download as a standalone plugin installer.', 'acf-block-builder' ); ?>
				</p>
				<button type="button" id="acf-block-builder-export-theme" class="button button-secondary button-large" style="width: 100%; justify-content: center; display: flex; align-items: center; gap: 5px; margin-top: 15px;" data-post-id="<?php echo esc_attr( $post->ID ); ?>">
					<span class="dashicons dashicons-admin-appearance"></span> <?php _e( 'Export to Theme', 'acf-block-builder' ); ?>
				</button>
				<p class="description" style="margin-top: 10px;">
					<?php _e( 'Copy block files directly to the active theme\'s "blocks" directory.', 'acf-block-builder' ); ?>
				</p>
			<?php else : ?>
				<p><?php _e( 'Save the post to enable export.', 'acf-block-builder' ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}

	public function render_fields_preview_meta_box( $post ) {
		$fields_php = get_post_meta( $post->ID, '_acf_block_builder_fields', true );

		if ( empty( $fields_php ) ) {
			echo '<p>' . __( 'No fields found.', 'acf-block-builder' ) . '</p>';
			return;
		}

		$lines = explode( "\n", $fields_php );
		$fields = [];
		$current_field = [];
		$has_field_started = false;

		foreach ( $lines as $line ) {
			// Normalize tabs to 4 spaces for consistent calculation
			$line_content = str_replace( "\t", "    ", $line );
			$trimmed_line = trim( $line_content );

			// Check for new field start (key)
			if ( strpos( $trimmed_line, "'key' => 'field_" ) !== false ) {
				if ( ! empty( $current_field ) && $has_field_started ) {
					$fields[] = $current_field;
				}
				
				// Calculate indentation level
				$indent = strlen( $line_content ) - strlen( ltrim( $line_content ) );

				$current_field = [ 'label' => '', 'name' => '', 'type' => '', 'indent' => $indent ];
				$has_field_started = true;
			}

			if ( $has_field_started ) {
				// Extract attributes
				if ( preg_match( "/'label'\s*=>\s*'([^']*)'/", $trimmed_line, $matches ) ) {
					$current_field['label'] = $matches[1];
				}
				if ( preg_match( "/'name'\s*=>\s*'([^']*)'/", $trimmed_line, $matches ) ) {
					$current_field['name'] = $matches[1];
				}
				if ( preg_match( "/'type'\s*=>\s*'([^']*)'/", $trimmed_line, $matches ) ) {
					$current_field['type'] = $matches[1];
				}
			}
		}
		// Add last field
		if ( ! empty( $current_field ) && $has_field_started ) {
			$fields[] = $current_field;
		}

		if ( empty( $fields ) ) {
			echo '<p>' . __( 'Could not parse fields. Please check the code in fields.php tab.', 'acf-block-builder' ) . '</p>';
			return;
		}

		// Calculate base indent
		$base_indent = 0;
		if ( ! empty( $fields ) ) {
			$base_indent = $fields[0]['indent'];
			foreach ( $fields as $field ) {
				if ( $field['indent'] < $base_indent ) {
					$base_indent = $field['indent'];
				}
			}
		}

		echo '<table class="widefat striped acf-bb-fields-table">';
		echo '<thead><tr><th>' . __( 'Label', 'acf-block-builder' ) . '</th><th>' . __( 'Name', 'acf-block-builder' ) . '</th><th>' . __( 'Type', 'acf-block-builder' ) . '</th></tr></thead>';
		echo '<tbody>';
		foreach ( $fields as $field ) {
			$level = max( 0, ( $field['indent'] - $base_indent ) / 4 ); // Assume 4 space indentation step
			$padding = $level * 20;
			$style = $padding > 0 ? 'style="padding-left: ' . ( 10 + $padding ) . 'px;"' : '';
			$marker = $level > 0 ? '<span class="dashicons dashicons-arrow-return-right" style="font-size: 14px; width: 14px; height: 14px; line-height: 14px; margin-right: 5px;"></span>' : '';

			echo '<tr>';
			echo '<td ' . $style . '>' . $marker . esc_html( $field['label'] ?? '' ) . '</td>';
			echo '<td><code>' . esc_html( $field['name'] ?? '' ) . '</code></td>';
			echo '<td>' . esc_html( $field['type'] ?? '' ) . '</td>';
			echo '</tr>';
		}
		echo '</tbody>';
		echo '</table>';
	}

	public function render_chat_meta_box( $post ) {
		wp_nonce_field( 'acf_block_builder_save', 'acf_block_builder_nonce' );

		// Get chat history
		$chat_history_json = get_post_meta( $post->ID, '_acf_block_builder_chat_history', true );
		$chat_history = json_decode( $chat_history_json, true );
		if ( ! is_array( $chat_history ) ) {
			$chat_history = [];
		}
		
		?>
		<div class="acf-block-builder-container">
			<div class="acf-bb-chat-interface">
				<!-- Chat Messages -->
				<div class="acf-bb-chat-messages" id="acf-bb-chat-messages">
					<?php if ( empty( $chat_history ) ) : ?>
						<div class="acf-bb-message ai-message">
							<div class="acf-bb-avatar"><span class="dashicons dashicons-superhero"></span></div>
							<div class="acf-bb-message-content">
								<?php _e( 'Hello! Describe the block you want to build, or upload a reference image.', 'acf-block-builder' ); ?>
							</div>
						</div>
					<?php endif; ?>
					<?php // Chat history is rendered by JavaScript from the hidden field to handle structured data properly ?>
				</div>
				
				<!-- Input Area -->
				<div class="acf-bb-input-wrapper">
					<div class="acf-bb-input-container">
						<div class="acf-bb-input-actions-left">
							<button type="button" id="acf-bb-upload-image" class="acf-bb-icon-btn" title="<?php _e( 'Attach Image', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-paperclip"></span>
							</button>
							<button type="button" id="acf-bb-mention-files" class="acf-bb-icon-btn" title="<?php _e( 'Mention Files (@)', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-media-code"></span>
							</button>
						</div>
						
						<div class="acf-bb-input-field">
							<div id="acf-bb-image-preview-mini" class="acf-bb-attachment-preview" style="display: none;"></div>
							<textarea 
								id="acf_block_builder_prompt" 
								name="acf_block_builder_prompt" 
								rows="1" 
								placeholder="<?php _e( 'Message AI Block Builder...', 'acf-block-builder' ); ?>"
								data-placeholder-agent="<?php esc_attr_e( 'Describe your block or request changes...', 'acf-block-builder' ); ?>"
								data-placeholder-ask="<?php esc_attr_e( 'Ask a question about your block...', 'acf-block-builder' ); ?>"
							></textarea>
						</div>
						
						<div class="acf-bb-input-actions-right">
							<button type="button" id="acf-block-builder-generate" class="acf-bb-send-btn" disabled>
								<span class="dashicons dashicons-arrow-up-alt2"></span>
							</button>
						</div>
					</div>
				</div>
				
				<!-- Controls Footer - Mode Switcher and Model Selector -->
				<div class="acf-bb-controls-footer">
					<div class="acf-bb-controls-left">
						<div class="acf-bb-mode-switcher">
							<button type="button" class="acf-bb-mode-btn active" data-mode="agent" title="<?php esc_attr_e( 'Agent Mode - Full code generation and updates', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-admin-tools"></span>
								<span class="acf-bb-mode-label"><?php _e( 'Agent', 'acf-block-builder' ); ?></span>
							</button>
							<button type="button" class="acf-bb-mode-btn" data-mode="ask" title="<?php esc_attr_e( 'Ask Mode - Questions and guidance only', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-format-chat"></span>
								<span class="acf-bb-mode-label"><?php _e( 'Ask', 'acf-block-builder' ); ?></span>
							</button>
						</div>
					</div>
					
					<div class="acf-bb-controls-right">
						<button type="button" id="acf-bb-clear-history" class="acf-bb-icon-btn" title="<?php esc_attr_e( 'Clear Chat History', 'acf-block-builder' ); ?>">
							<span class="dashicons dashicons-trash"></span>
						</button>
						<div class="acf-bb-model-selector">
							<button type="button" class="acf-bb-model-trigger" id="acf-bb-model-trigger">
								<span class="acf-bb-model-icon"></span>
								<span class="acf-bb-model-name"><?php _e( 'Loading...', 'acf-block-builder' ); ?></span>
								<span class="dashicons dashicons-arrow-down-alt2"></span>
							</button>
							<div class="acf-bb-model-dropdown" id="acf-bb-model-dropdown">
								<!-- Will be populated by JavaScript -->
							</div>
							<select id="acf_block_builder_model" name="acf_block_builder_model" style="display: none;">
								<option value=""><?php esc_html_e( 'Loading models...', 'acf-block-builder' ); ?></option>
							</select>
						</div>
					</div>
				</div>
				
				<input type="hidden" id="acf_block_builder_image_id" name="acf_block_builder_image_id" value="">
				<input type="hidden" id="acf_block_builder_mode" name="acf_block_builder_mode" value="agent">
				<input type="hidden" name="acf_block_builder_chat_history" id="acf_block_builder_chat_history" value="<?php echo esc_attr( $chat_history_json ); ?>">
			</div>
			
			<div id="acf-bb-loading-overlay" class="acf-bb-overlay" style="display: none;">
				<div class="acf-bb-overlay-content">
					<div class="acf-bb-spinner"></div>
					<div class="acf-bb-loading-text"><?php _e( 'Analyzing your request...', 'acf-block-builder' ); ?></div>
					<div class="acf-bb-timer">00:00</div>
				</div>
			</div>
			
			<div id="acf-bb-diff-overlay" class="acf-bb-overlay" style="display: none;">
				<div class="acf-bb-overlay-content acf-bb-diff-content">
					<div class="acf-bb-diff-header">
						<h3><?php _e( 'Review AI Changes', 'acf-block-builder' ); ?></h3>
						<div class="acf-bb-diff-actions">
							<button type="button" id="acf-bb-diff-cancel" class="button button-secondary"><?php _e( 'Discard', 'acf-block-builder' ); ?></button>
							<button type="button" id="acf-bb-diff-apply" class="button button-primary"><?php _e( 'Apply Changes', 'acf-block-builder' ); ?></button>
						</div>
					</div>
					
					<div class="acf-bb-tabs acf-bb-diff-tabs">
						<a href="#" class="acf-bb-tab active" data-diff-tab="block-json"><span class="dashicons dashicons-media-code"></span> block.json <span class="acf-bb-tab-status"></span></a>
						<a href="#" class="acf-bb-tab" data-diff-tab="render-php"><span class="dashicons dashicons-editor-code"></span> render.php <span class="acf-bb-tab-status"></span></a>
						<a href="#" class="acf-bb-tab" data-diff-tab="style-css"><span class="dashicons dashicons-art"></span> style.css <span class="acf-bb-tab-status"></span></a>
						<a href="#" class="acf-bb-tab" data-diff-tab="script-js"><span class="dashicons dashicons-media-default"></span> script.js <span class="acf-bb-tab-status"></span></a>
						<a href="#" class="acf-bb-tab" data-diff-tab="fields-php"><span class="dashicons dashicons-database"></span> fields.php <span class="acf-bb-tab-status"></span></a>
						<a href="#" class="acf-bb-tab" data-diff-tab="assets-php"><span class="dashicons dashicons-admin-links"></span> assets.php <span class="acf-bb-tab-status"></span></a>
					</div>

					<!-- File-level actions toolbar -->
					<div class="acf-bb-diff-toolbar">
						<div class="acf-bb-diff-file-actions">
							<button type="button" id="acf-bb-file-reject" class="button button-secondary acf-bb-file-btn" title="<?php esc_attr_e( 'Reject all changes in this file', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-no"></span> <?php _e( 'Undo', 'acf-block-builder' ); ?>
							</button>
							<button type="button" id="acf-bb-file-accept" class="button button-primary acf-bb-file-btn" title="<?php esc_attr_e( 'Accept all changes in this file', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-yes"></span> <?php _e( 'Keep', 'acf-block-builder' ); ?>
							</button>
						</div>
						<div class="acf-bb-diff-nav">
							<button type="button" id="acf-bb-diff-prev" class="button button-secondary" title="<?php esc_attr_e( 'Previous change', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-arrow-up-alt2"></span>
							</button>
							<span class="acf-bb-diff-counter"><span id="acf-bb-diff-current">1</span> / <span id="acf-bb-diff-total">1</span></span>
							<button type="button" id="acf-bb-diff-next" class="button button-secondary" title="<?php esc_attr_e( 'Next change', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-arrow-down-alt2"></span>
							</button>
						</div>
						<div class="acf-bb-diff-file-nav">
							<button type="button" id="acf-bb-file-prev" class="button button-secondary" title="<?php esc_attr_e( 'Previous file', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-arrow-left-alt2"></span>
							</button>
							<span class="acf-bb-file-counter"><span id="acf-bb-file-current">1</span> / <span id="acf-bb-file-total">2</span> <?php _e( 'files', 'acf-block-builder' ); ?></span>
							<button type="button" id="acf-bb-file-next" class="button button-secondary" title="<?php esc_attr_e( 'Next file', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-arrow-right-alt2"></span>
							</button>
						</div>
					</div>

					<div id="acf-bb-diff-editor-container" class="monaco-editor-container" style="height: calc(90vh - 180px);"></div>
				</div>
			</div>
		</div>
		<?php
	}

	public function render_code_meta_box( $post ) {
		// Get existing values
		$block_json = get_post_meta( $post->ID, '_acf_block_builder_json', true );
		$block_php  = get_post_meta( $post->ID, '_acf_block_builder_php', true );
		$block_css  = get_post_meta( $post->ID, '_acf_block_builder_css', true );
		$block_js   = get_post_meta( $post->ID, '_acf_block_builder_js', true );
		$fields_php = get_post_meta( $post->ID, '_acf_block_builder_fields', true );
		$assets_php = get_post_meta( $post->ID, '_acf_block_builder_assets', true );
		
		?>
		<div class="acf-block-builder-container">
			<div class="code-editors-section">
				<div class="acf-bb-tabs">
					<a href="#" class="acf-bb-tab active" data-tab="block-json" data-file-type="json">
						<span class="dashicons dashicons-media-code"></span> block.json
						<span class="acf-bb-lint-badge" data-lint-tab="block-json"></span>
					</a>
					<a href="#" class="acf-bb-tab" data-tab="render-php" data-file-type="php">
						<span class="dashicons dashicons-editor-code"></span> render.php
						<span class="acf-bb-lint-badge" data-lint-tab="render-php"></span>
					</a>
					<a href="#" class="acf-bb-tab" data-tab="style-css" data-file-type="css">
						<span class="dashicons dashicons-art"></span> style.css
						<span class="acf-bb-lint-badge" data-lint-tab="style-css"></span>
					</a>
					<a href="#" class="acf-bb-tab" data-tab="script-js" data-file-type="js">
						<span class="dashicons dashicons-media-default"></span> script.js
						<span class="acf-bb-lint-badge" data-lint-tab="script-js"></span>
					</a>
					<a href="#" class="acf-bb-tab" data-tab="fields-php" data-file-type="fields">
						<span class="dashicons dashicons-database"></span> fields.php
						<span class="acf-bb-lint-badge" data-lint-tab="fields-php"></span>
					</a>
					<a href="#" class="acf-bb-tab" data-tab="assets-php" data-file-type="assets">
						<span class="dashicons dashicons-admin-links"></span> assets.php
						<span class="acf-bb-lint-badge" data-lint-tab="assets-php"></span>
					</a>
					<button type="button" class="acf-bb-history-btn" id="acf-bb-open-history" title="<?php esc_attr_e( 'View Version History', 'acf-block-builder' ); ?>">
						<span class="dashicons dashicons-backup"></span>
					</button>
				</div>

				<div class="acf-bb-editor-wrapper">
					<div class="acf-bb-tab-content active" id="tab-block-json">
						<div id="editor-block-json" class="monaco-editor-container"></div>
						<textarea name="acf_block_builder_json" id="textarea-block-json" class="hidden-textarea"><?php echo esc_textarea( $block_json ); ?></textarea>
					</div>

					<div class="acf-bb-tab-content" id="tab-render-php">
						<div id="editor-render-php" class="monaco-editor-container"></div>
						<textarea name="acf_block_builder_php" id="textarea-render-php" class="hidden-textarea"><?php echo esc_textarea( $block_php ); ?></textarea>
					</div>

					<div class="acf-bb-tab-content" id="tab-style-css">
						<div id="editor-style-css" class="monaco-editor-container"></div>
						<textarea name="acf_block_builder_css" id="textarea-style-css" class="hidden-textarea"><?php echo esc_textarea( $block_css ); ?></textarea>
					</div>

					<div class="acf-bb-tab-content" id="tab-script-js">
						<div id="editor-script-js" class="monaco-editor-container"></div>
						<textarea name="acf_block_builder_js" id="textarea-script-js" class="hidden-textarea"><?php echo esc_textarea( $block_js ); ?></textarea>
					</div>

					<div class="acf-bb-tab-content" id="tab-fields-php">
						<div id="editor-fields-php" class="monaco-editor-container"></div>
						<textarea name="acf_block_builder_fields" id="textarea-fields-php" class="hidden-textarea"><?php echo esc_textarea( $fields_php ); ?></textarea>
					</div>

					<div class="acf-bb-tab-content" id="tab-assets-php">
						<div id="editor-assets-php" class="monaco-editor-container"></div>
						<textarea name="acf_block_builder_assets" id="textarea-assets-php" class="hidden-textarea"><?php echo esc_textarea( $assets_php ); ?></textarea>
					</div>
				</div>
				
				<!-- Problems Panel -->
				<div class="acf-bb-problems-panel" id="acf-bb-problems-panel">
					<div class="acf-bb-problems-header">
						<button type="button" class="acf-bb-problems-toggle" id="acf-bb-problems-toggle">
							<span class="dashicons dashicons-warning"></span>
							<span class="acf-bb-problems-title"><?php esc_html_e( 'Problems', 'acf-block-builder' ); ?></span>
							<span class="acf-bb-problems-count" id="acf-bb-problems-count">0</span>
							<span class="dashicons dashicons-arrow-up-alt2 acf-bb-toggle-icon"></span>
						</button>
						<div class="acf-bb-problems-actions">
							<button type="button" class="acf-bb-show-ignored" id="acf-bb-show-ignored" title="<?php esc_attr_e( 'Show ignored problems', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-hidden"></span>
								<span class="acf-bb-ignored-count">0</span>
							</button>
							<button type="button" class="acf-bb-fix-with-ai" id="acf-bb-fix-with-ai" disabled title="<?php esc_attr_e( 'Send errors to AI for help', 'acf-block-builder' ); ?>">
								<span class="dashicons dashicons-superhero"></span>
								<?php esc_html_e( 'Fix with AI', 'acf-block-builder' ); ?>
							</button>
						</div>
					</div>
					<div class="acf-bb-problems-content" id="acf-bb-problems-content">
						<div class="acf-bb-problems-empty">
							<span class="dashicons dashicons-yes-alt"></span>
							<?php esc_html_e( 'No problems detected', 'acf-block-builder' ); ?>
						</div>
						<div class="acf-bb-problems-list" id="acf-bb-problems-list"></div>
						
						<!-- Ignored Problems Section -->
						<div class="acf-bb-ignored-problems" id="acf-bb-ignored-problems" style="display: none;">
							<div class="acf-bb-ignored-header">
								<span class="dashicons dashicons-hidden"></span>
								<?php esc_html_e( 'Ignored Problems', 'acf-block-builder' ); ?>
								<button type="button" class="acf-bb-clear-ignored" id="acf-bb-clear-ignored">
									<?php esc_html_e( 'Clear All', 'acf-block-builder' ); ?>
								</button>
							</div>
							<div class="acf-bb-ignored-list" id="acf-bb-ignored-list"></div>
						</div>
					</div>
				</div>
				
				<!-- Hidden field to store ignored errors -->
				<input type="hidden" name="acf_block_builder_ignored_errors" id="acf-bb-ignored-errors" value="<?php echo esc_attr( get_post_meta( $post->ID, '_acf_block_builder_ignored_errors', true ) ); ?>" />
			</div>
			
			<!-- Version History Overlay -->
			<div id="acf-bb-version-overlay" class="acf-bb-overlay" style="display: none;">
				<div class="acf-bb-overlay-content acf-bb-version-content">
					<div class="acf-bb-version-header">
						<h3><span class="dashicons dashicons-backup"></span> <?php _e( 'Version History', 'acf-block-builder' ); ?></h3>
						<button type="button" id="acf-bb-version-close" class="acf-bb-close-btn">&times;</button>
					</div>
					
					<div class="acf-bb-version-layout">
						<!-- File tabs and version list sidebar -->
						<div class="acf-bb-version-sidebar">
							<div class="acf-bb-version-file-tabs">
								<button type="button" class="acf-bb-version-file-tab active" data-file-type="json">
									<span class="file-name">block.json</span>
									<span class="version-count" data-count-for="json">-</span>
								</button>
								<button type="button" class="acf-bb-version-file-tab" data-file-type="php">
									<span class="file-name">render.php</span>
									<span class="version-count" data-count-for="php">-</span>
								</button>
								<button type="button" class="acf-bb-version-file-tab" data-file-type="css">
									<span class="file-name">style.css</span>
									<span class="version-count" data-count-for="css">-</span>
								</button>
								<button type="button" class="acf-bb-version-file-tab" data-file-type="js">
									<span class="file-name">script.js</span>
									<span class="version-count" data-count-for="js">-</span>
								</button>
								<button type="button" class="acf-bb-version-file-tab" data-file-type="fields">
									<span class="file-name">fields.php</span>
									<span class="version-count" data-count-for="fields">-</span>
								</button>
								<button type="button" class="acf-bb-version-file-tab" data-file-type="assets">
									<span class="file-name">assets.php</span>
									<span class="version-count" data-count-for="assets">-</span>
								</button>
							</div>
							
							<div class="acf-bb-version-list-container">
								<div class="acf-bb-version-list" id="acf-bb-version-list">
									<!-- Populated via JavaScript -->
								</div>
							</div>
						</div>
						
						<!-- Diff viewer main area -->
						<div class="acf-bb-version-main">
							<div class="acf-bb-version-toolbar">
								<div class="acf-bb-version-compare-info">
									<span class="acf-bb-compare-label"><?php _e( 'Comparing:', 'acf-block-builder' ); ?></span>
									<select id="acf-bb-version-from" class="acf-bb-version-select">
										<option value=""><?php _e( 'Select version...', 'acf-block-builder' ); ?></option>
									</select>
									<span class="acf-bb-compare-arrow">→</span>
									<select id="acf-bb-version-to" class="acf-bb-version-select">
										<option value=""><?php _e( 'Select version...', 'acf-block-builder' ); ?></option>
									</select>
								</div>
								<div class="acf-bb-version-actions">
									<button type="button" id="acf-bb-version-restore" class="button button-primary" disabled>
										<span class="dashicons dashicons-undo"></span> <?php _e( 'Restore Selected', 'acf-block-builder' ); ?>
									</button>
								</div>
							</div>
							
							<div id="acf-bb-version-diff-container" class="acf-bb-version-diff-container">
								<div class="acf-bb-version-placeholder">
									<span class="dashicons dashicons-visibility"></span>
									<p><?php _e( 'Select versions to compare or click on a version to preview it.', 'acf-block-builder' ); ?></p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<?php
	}

	public function save_post( $post_id ) {
		if ( ! isset( $_POST['acf_block_builder_nonce'] ) || ! wp_verify_nonce( $_POST['acf_block_builder_nonce'], 'acf_block_builder_save' ) ) {
			return;
		}

		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		// Save meta fields
		$fields = array(
			'acf_block_builder_json',
			'acf_block_builder_php',
			'acf_block_builder_css',
			'acf_block_builder_js',
			'acf_block_builder_fields',
			'acf_block_builder_assets',
			'acf_block_builder_prompt',
			'acf_block_builder_chat_history',
		);

		// Handle checkbox for active status (if unchecked, it won't be in $_POST)
		$is_active = isset( $_POST['acf_block_builder_active'] ) ? '1' : '0';
		update_post_meta( $post_id, '_acf_block_builder_active', $is_active );

		$is_json_sync = isset( $_POST['acf_block_builder_json_sync'] ) ? '1' : '0';
		update_post_meta( $post_id, '_acf_block_builder_json_sync', $is_json_sync );

		foreach ( $fields as $field ) {
			if ( isset( $_POST[ $field ] ) ) {
				update_post_meta( $post_id, '_' . $field, $_POST[ $field ] );
			}
		}
		
		// Save ignored errors
		if ( isset( $_POST['acf_block_builder_ignored_errors'] ) ) {
			update_post_meta( $post_id, '_acf_block_builder_ignored_errors', sanitize_textarea_field( $_POST['acf_block_builder_ignored_errors'] ) );
		}

		// Trigger file generation
		$this->generate_block_files( $post_id );

		// Save file versions (per-file version control)
		if ( class_exists( 'ACF_Block_Builder_File_Versions' ) ) {
			$versions_handler = new ACF_Block_Builder_File_Versions();
			$versions_handler->save_file_versions( $post_id );
		}
	}

	// Public so revisions handler can call it
	public function generate_block_files( $post_id ) {
		// Logic to write files to disk
		$block_slug = get_post_field( 'post_name', $post_id );
		if ( empty( $block_slug ) ) {
			return;
		}

		$upload_dir = wp_upload_dir();
		$block_dir  = $upload_dir['basedir'] . '/acf-blocks/' . $block_slug;

		if ( ! file_exists( $block_dir ) ) {
			wp_mkdir_p( $block_dir );
		}

		// Write block.json
		$json_content = get_post_meta( $post_id, '_acf_block_builder_json', true );
		
		// Check for CSS/JS and update block.json if needed
		$css_content = get_post_meta( $post_id, '_acf_block_builder_css', true );
		$js_content  = get_post_meta( $post_id, '_acf_block_builder_js', true );
		
		if ( $json_content ) {
			$metadata = json_decode( stripslashes( $json_content ), true );
			
			if ( $metadata ) {
				if ( ! empty( $css_content ) ) {
					// Ensure style is registered
					if ( ! isset( $metadata['style'] ) ) {
						$metadata['style'] = 'file:./style.css';
					} elseif ( is_string( $metadata['style'] ) && $metadata['style'] !== 'file:./style.css' ) {
						// If it's a string but different, maybe convert to array or just override?
						// For simplicity, let's assume if we have custom CSS, we want to use it.
						// But if AI generated something else, we should respect it?
						// Let's force it if it's missing.
					}
				}
				
				if ( ! empty( $js_content ) ) {
					// Ensure script is registered
					if ( ! isset( $metadata['script'] ) ) {
						$metadata['script'] = 'file:./script.js';
					}
				}
				
				// Re-encode
				$json_content = json_encode( $metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
			}
			
			file_put_contents( $block_dir . '/block.json', $json_content );
		}

		// Write render.php
		$php_content = get_post_meta( $post_id, '_acf_block_builder_php', true );
		if ( $php_content ) {
			file_put_contents( $block_dir . '/render.php', stripslashes( $php_content ) );
		}

		// Write style.css
		$css_content = get_post_meta( $post_id, '_acf_block_builder_css', true );
		if ( $css_content ) {
			file_put_contents( $block_dir . '/style.css', stripslashes( $css_content ) );
		}

		// Write script.js
		$js_content = get_post_meta( $post_id, '_acf_block_builder_js', true );
		if ( $js_content ) {
			file_put_contents( $block_dir . '/script.js', stripslashes( $js_content ) );
			
			// Generate script.asset.php to ensure jQuery dependency
			$asset_content = "<?php return array('dependencies' => array('jquery'), 'version' => '" . date('YmdHis') . "');";
			file_put_contents( $block_dir . '/script.asset.php', $asset_content );
		}

		// Write fields.php
		$fields_content = get_post_meta( $post_id, '_acf_block_builder_fields', true );
		if ( $fields_content ) {
			file_put_contents( $block_dir . '/fields.php', stripslashes( $fields_content ) );
		}

		// Handle JSON Sync Generation
		$is_sync = get_post_meta( $post_id, '_acf_block_builder_json_sync', true );
		if ( '1' === $is_sync && file_exists( $block_dir . '/fields.php' ) ) {
			$this->convert_fields_php_to_json( $block_dir . '/fields.php', $block_dir );
		}

		// Write assets.php
		$assets_content = get_post_meta( $post_id, '_acf_block_builder_assets', true );
		if ( $assets_content ) {
			file_put_contents( $block_dir . '/assets.php', stripslashes( $assets_content ) );
		}
	}

	public function convert_fields_php_to_json( $php_file, $output_dir ) {
		// 1. Extract the group key to look up later
		$content = file_get_contents( $php_file );
		$group_key = '';
		if ( preg_match( "/'key'\s*=>\s*'(group_[a-zA-Z0-9_]+)'/", $content, $matches ) ) {
			$group_key = $matches[1];
		}

		if ( empty( $group_key ) ) {
			return;
		}

		// 2. Include the file to register the group in ACF's local store
		// We use a clean buffer to prevent any output
		ob_start();
		try {
			if ( file_exists( $php_file ) ) {
				include $php_file;
			}
		} catch ( Exception $e ) {
			// Ignore errors
		}
		ob_end_clean();

		// 3. Retrieve the full group object from ACF
		$group = false;
		if ( function_exists( 'acf_get_local_field_group' ) ) {
			$group = acf_get_local_field_group( $group_key );
		}
		
		// If acf_get_local_field_group failed, try getting it from global $acf_field_groups if available (older ACF versions or just in-memory)
		if ( ! $group && isset( $GLOBALS['acf_field_groups'] ) && is_array( $GLOBALS['acf_field_groups'] ) ) {
			foreach ( $GLOBALS['acf_field_groups'] as $g ) {
				if ( $g['key'] === $group_key ) {
					$group = $g;
					break;
				}
			}
		}

		// If still not found, try to manually construct it from the capture if we use the filter method again
		// Let's re-add the capture filter method as a fallback because acf_get_local_field_group might rely on it being registered via acf_add_local_field_group which we just did in the include.
		
		if ( $group ) {
			// Ensure modified time is set
			$group['modified'] = time();
			
			// Ensure fields are present
			// For local fields added via code, we need to ensure they are fully loaded.
			if ( function_exists( 'acf_get_fields' ) ) {
				$fields = acf_get_fields( $group_key );
				if ( $fields ) {
					$group['fields'] = $fields;
				}
			}
			
			// Determine filename - use key.json
			$filename = $group['key'] . '.json';
			
			$json_content = json_encode( $group, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
			
			if ( $json_content ) {
				file_put_contents( $output_dir . '/' . $filename, $json_content );
			}
		}
	}

	public function handle_export_zip() {
		if ( ! isset( $_GET['nonce'] ) || ! wp_verify_nonce( $_GET['nonce'], 'acf_block_builder_export' ) ) {
			wp_die( 'Security check failed.' );
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_die( 'Permission denied.' );
		}

		$post_id = isset( $_GET['post_id'] ) ? intval( $_GET['post_id'] ) : 0;
		if ( ! $post_id ) {
			wp_die( 'Invalid Post ID.' );
		}

		$block_slug = get_post_field( 'post_name', $post_id );
		if ( empty( $block_slug ) ) {
			wp_die( 'Block slug not found.' );
		}

		$upload_dir = wp_upload_dir();
		$block_dir  = $upload_dir['basedir'] . '/acf-blocks/' . $block_slug;

		if ( ! file_exists( $block_dir ) ) {
			wp_die( 'Block folder not found.' );
		}

		$zip_file = sys_get_temp_dir() . '/' . $block_slug . '.zip';
		$zip = new ZipArchive();

		if ( $zip->open( $zip_file, ZipArchive::CREATE | ZipArchive::OVERWRITE ) !== TRUE ) {
			wp_die( 'Could not create zip file.' );
		}

		$files = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $block_dir, RecursiveDirectoryIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::LEAVES_ONLY
		);

		foreach ( $files as $name => $file ) {
			if ( ! $file->isDir() ) {
				$filePath = $file->getRealPath();
				$relativePath = substr( $filePath, strlen( $block_dir ) + 1 );
				$zip->addFile( $filePath, $relativePath );
			}
		}

		$zip->close();

		while ( ob_get_level() ) {
			ob_end_clean();
		}

		header( 'Content-Type: application/zip' );
		header( 'Content-Disposition: attachment; filename="' . basename( $zip_file ) . '"' );
		header( 'Content-Length: ' . filesize( $zip_file ) );
		header( 'Pragma: no-cache' );
		
		readfile( $zip_file );
		unlink( $zip_file );
		exit;
	}

	public function handle_export_plugin() {
		if ( ! isset( $_GET['nonce'] ) || ! wp_verify_nonce( $_GET['nonce'], 'acf_block_builder_export' ) ) {
			wp_die( 'Security check failed.' );
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_die( 'Permission denied.' );
		}

		$post_id = isset( $_GET['post_id'] ) ? intval( $_GET['post_id'] ) : 0;
		if ( ! $post_id ) {
			wp_die( 'Invalid Post ID.' );
		}

		$block_slug = get_post_field( 'post_name', $post_id );
		$block_title = get_the_title( $post_id );
		if ( empty( $block_slug ) ) {
			wp_die( 'Block slug not found.' );
		}

		$upload_dir = wp_upload_dir();
		$block_dir  = $upload_dir['basedir'] . '/acf-blocks/' . $block_slug;

		if ( ! file_exists( $block_dir ) ) {
			wp_die( 'Block folder not found.' );
		}

		$plugin_slug = 'acf-block-' . $block_slug;
		$zip_file = sys_get_temp_dir() . '/' . $plugin_slug . '.zip';
		$zip = new ZipArchive();

		if ( $zip->open( $zip_file, ZipArchive::CREATE | ZipArchive::OVERWRITE ) !== TRUE ) {
			wp_die( 'Could not create zip file.' );
		}

		// Create Main Plugin File
		$plugin_header = "<?php\n/**\n * Plugin Name: " . esc_html( $block_title ) . " Block\n * Description: A standalone ACF Block.\n * Version: 1.0.0\n * Author: ACF Block Builder\n * Text Domain: " . esc_html( $plugin_slug ) . "\n */\n\n";
		$plugin_header .= "if ( ! defined( 'ABSPATH' ) ) exit;\n\n";
		$plugin_header .= "add_action( 'init', 'register_acf_block_" . str_replace( '-', '_', $block_slug ) . "' );\n";
		$plugin_header .= "function register_acf_block_" . str_replace( '-', '_', $block_slug ) . "() {\n";
		$plugin_header .= "\tregister_block_type( __DIR__ . '/blocks/" . $block_slug . "' );\n";
		$plugin_header .= "\n";
		$plugin_header .= "\t// Load ACF Fields\n";
		$plugin_header .= "\tif ( file_exists( __DIR__ . '/blocks/" . $block_slug . "/fields.php' ) ) {\n";
		$plugin_header .= "\t\trequire_once __DIR__ . '/blocks/" . $block_slug . "/fields.php';\n";
		$plugin_header .= "\t}\n";
		$plugin_header .= "\n";
		$plugin_header .= "\t// Load Assets\n";
		$plugin_header .= "\tif ( file_exists( __DIR__ . '/blocks/" . $block_slug . "/assets.php' ) ) {\n";
		$plugin_header .= "\t\trequire_once __DIR__ . '/blocks/" . $block_slug . "/assets.php';\n";
		$plugin_header .= "\t}\n";
		$plugin_header .= "}\n";

		$zip->addFromString( $plugin_slug . '/' . $plugin_slug . '.php', $plugin_header );

		// Add Block Files
		$files = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $block_dir, RecursiveDirectoryIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::LEAVES_ONLY
		);

		foreach ( $files as $name => $file ) {
			if ( ! $file->isDir() ) {
				$filePath = $file->getRealPath();
				$relativePath = substr( $filePath, strlen( $block_dir ) + 1 );
				$zip->addFile( $filePath, $plugin_slug . '/blocks/' . $block_slug . '/' . $relativePath );
			}
		}

		$zip->close();

		while ( ob_get_level() ) {
			ob_end_clean();
		}

		header( 'Content-Type: application/zip' );
		header( 'Content-Disposition: attachment; filename="' . basename( $zip_file ) . '"' );
		header( 'Content-Length: ' . filesize( $zip_file ) );
		header( 'Pragma: no-cache' );
		
		readfile( $zip_file );
		unlink( $zip_file );
		exit;
	}

	public function handle_export_theme() {
		check_ajax_referer( 'acf_block_builder_export', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
		if ( ! $post_id ) {
			wp_send_json_error( 'Invalid Post ID.' );
		}

		$block_slug = get_post_field( 'post_name', $post_id );
		if ( empty( $block_slug ) ) {
			wp_send_json_error( 'Block slug not found.' );
		}

		$upload_dir = wp_upload_dir();
		$source_dir = $upload_dir['basedir'] . '/acf-blocks/' . $block_slug;

		if ( ! file_exists( $source_dir ) ) {
			wp_send_json_error( 'Block folder not found.' );
		}

		$theme_dir = get_stylesheet_directory();
		$target_dir = $theme_dir . '/blocks/' . $block_slug;

		if ( ! file_exists( dirname( $target_dir ) ) ) {
			if ( ! mkdir( dirname( $target_dir ), 0755, true ) ) {
				wp_send_json_error( 'Could not create "blocks" directory in theme.' );
			}
		}

		if ( ! file_exists( $target_dir ) ) {
			if ( ! mkdir( $target_dir, 0755, true ) ) {
				wp_send_json_error( 'Could not create block directory in theme.' );
			}
		}

		// Copy files
		$files = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $source_dir, RecursiveDirectoryIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::LEAVES_ONLY
		);

		foreach ( $files as $name => $file ) {
			if ( ! $file->isDir() ) {
				$filePath = $file->getRealPath();
				$relativePath = substr( $filePath, strlen( $source_dir ) + 1 );
				$destPath = $target_dir . '/' . $relativePath;
				
				$destDir = dirname( $destPath );
				if ( ! file_exists( $destDir ) ) {
					mkdir( $destDir, 0755, true );
				}

				copy( $filePath, $destPath );
			}
		}

		wp_send_json_success( sprintf( __( 'Block exported to %s', 'acf-block-builder' ), $target_dir ) );
	}


	public function enqueue_scripts( $hook ) {
		global $post;

		if ( $hook == 'edit.php' && isset( $_GET['post_type'] ) && 'acf_block_builder' === $_GET['post_type'] ) {
			wp_enqueue_script( 'acf-block-builder-list', ACF_BLOCK_BUILDER_URL . 'assets/js/block-list.js', array( 'jquery' ), ACF_BLOCK_BUILDER_VERSION, true );
			wp_localize_script( 'acf-block-builder-list', 'acfBlockBuilderList', array(
				'ajax_url' => admin_url( 'admin-ajax.php' ),
				'nonce'    => wp_create_nonce( 'acf_block_builder_toggle' ),
			));
			wp_enqueue_style( 'acf-block-builder-css', ACF_BLOCK_BUILDER_URL . 'assets/css/block-editor.css', array(), ACF_BLOCK_BUILDER_VERSION );
		}

		if ( $hook == 'post-new.php' || $hook == 'post.php' ) {
			if ( 'acf_block_builder' === $post->post_type ) {
				// PHP Parser for client-side PHP linting - MUST load BEFORE Monaco's AMD loader
				// Otherwise the AMD loader hijacks php-parser and it won't register as a global
				wp_enqueue_script( 'php-parser', 'https://cdn.jsdelivr.net/npm/php-parser@3.2.5/dist/php-parser.min.js', array( 'jquery' ), '3.2.5', true );
				
				// Add Node.js polyfills BEFORE php-parser loads (it expects Node.js environment)
				wp_add_inline_script( 'php-parser', '
					if (typeof window.process === "undefined") {
						window.process = { env: {}, version: "", platform: "browser" };
					}
					if (typeof window.global === "undefined") {
						window.global = window;
					}
				', 'before' );
				
				// Enqueue Monaco Editor
				// We add wp-backbone/underscore/jquery as dependencies to ensure they load BEFORE Monaco.
				// If Monaco (AMD loader) loads first, it defines 'define', causing Backbone to register as an AMD module 
				// instead of a global, breaking WP scripts that expect window.Backbone.
				wp_enqueue_script( 'monaco-editor', 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.js', array( 'jquery', 'underscore', 'wp-backbone', 'wp-util', 'php-parser' ), '0.44.0', true );
				
				wp_enqueue_script( 'acf-block-builder-js', ACF_BLOCK_BUILDER_URL . 'assets/js/block-editor.js', array( 'jquery', 'monaco-editor' ), ACF_BLOCK_BUILDER_VERSION, true );
				
				wp_localize_script( 'acf-block-builder-js', 'acfBlockBuilder', array(
					'ajax_url' => admin_url( 'admin-ajax.php' ),
					'nonce'    => wp_create_nonce( 'acf_block_builder_ai' ),
					'export_nonce' => wp_create_nonce( 'acf_block_builder_export' ),
					'versions_nonce' => wp_create_nonce( 'acf_block_builder_versions' ),
					'post_id' => $post->ID,
					'plugin_url' => ACF_BLOCK_BUILDER_URL,
					'i18n' => array(
						'version_history' => __( 'Version History', 'acf-block-builder' ),
						'compare' => __( 'Compare', 'acf-block-builder' ),
						'restore' => __( 'Restore', 'acf-block-builder' ),
						'current' => __( 'Current', 'acf-block-builder' ),
						'restored' => __( 'Restored successfully!', 'acf-block-builder' ),
						'no_versions' => __( 'No version history yet. Save the post to create versions.', 'acf-block-builder' ),
						'comparing' => __( 'Comparing versions...', 'acf-block-builder' ),
						'select_versions' => __( 'Select two versions to compare', 'acf-block-builder' ),
						'confirm_restore' => __( 'Are you sure you want to restore this version? This will replace the current content.', 'acf-block-builder' ),
					),
				));

				wp_enqueue_style( 'acf-block-builder-css', ACF_BLOCK_BUILDER_URL . 'assets/css/block-editor.css', array(), ACF_BLOCK_BUILDER_VERSION );
			}
		}
	}
}

new ACF_Block_Builder_Meta_Boxes();

