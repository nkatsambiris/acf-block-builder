<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACF_Block_Builder_Settings {

	private $settings_page_hook;

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_settings_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'wp_ajax_acf_block_builder_add_theme_loader', array( $this, 'handle_add_theme_loader' ) );
	}

	public function enqueue_assets( $hook ) {
		// Use the stored hook suffix if available, otherwise fallback or check generically
		if ( $this->settings_page_hook && $hook !== $this->settings_page_hook ) {
			return;
		}

		// Fallback check if property isn't set for some reason (e.g. strict order issues, though admin_menu is before admin_enqueue_scripts)
		if ( ! $this->settings_page_hook && 'acf-block_page_acf-block-builder-settings' !== $hook ) {
			return;
		}

		wp_enqueue_style( 
			'acf-block-builder-settings', 
			ACF_BLOCK_BUILDER_URL . 'assets/css/admin-settings.css', 
			array(), 
			ACF_BLOCK_BUILDER_VERSION 
		);
	}

	public function add_settings_page() {
		$this->settings_page_hook = add_submenu_page(
			'edit.php?post_type=acf_block_builder',
			__( 'Settings', 'acf-block-builder' ),
			__( 'Settings', 'acf-block-builder' ),
			'manage_options',
			'acf-block-builder-settings',
			array( $this, 'render_settings_page' )
		);
	}

	public function register_settings() {
		register_setting( 'acf_block_builder_settings', 'acf_block_builder_gemini_api_key' );
		register_setting( 'acf_block_builder_settings', 'acf_block_builder_openai_api_key' );
		register_setting( 'acf_block_builder_settings', 'acf_block_builder_anthropic_api_key' );
		register_setting( 'acf_block_builder_settings', 'acf_block_builder_custom_instructions' );
		register_setting( 'acf_block_builder_settings', 'acf_block_builder_debug_enabled' );
	}

	public function render_settings_page() {
		?>
		<div class="acf-bb-header-bar">
			<div class="acf-bb-header-inner">
				<div class="acf-bb-header-label">Settings</div>
				<div class="acf-block-builder-actions">
					<?php submit_button( __( 'Save Changes', 'acf-block-builder' ), 'button button-primary button-large', 'submit', false, array( 'form' => 'acf-block-builder-settings-form' ) ); ?>
				</div>
			</div>
		</div>
		<div class="wrap acf-block-builder-settings-wrap">
			<div class="acf-block-builder-header">
				<h1><?php echo esc_html__( 'ACF Block Builder Settings', 'acf-block-builder' ); ?></h1>
			</div>
			
			<form id="acf-block-builder-settings-form" method="post" action="options.php">
				<?php
				settings_fields( 'acf_block_builder_settings' );
				do_settings_sections( 'acf_block_builder_settings' );
				?>

				<div class="acf-block-builder-grid">
					<div class="acf-block-builder-main">
						
						<!-- AI Provider API Keys Card -->
						<div class="acf-block-builder-card">
							<div class="acf-block-builder-card-header">
								<h2><?php esc_html_e( 'AI Provider API Keys', 'acf-block-builder' ); ?></h2>
							</div>
							<div class="acf-block-builder-card-body">
								<p class="acf-block-builder-description" style="margin-bottom: 20px;">
									<?php esc_html_e( 'Configure API keys for the AI providers you want to use. You can add keys for multiple providers and switch between them when chatting.', 'acf-block-builder' ); ?>
								</p>
								
								<div class="acf-block-builder-field-group">
									<label class="acf-block-builder-field-label" for="acf_block_builder_anthropic_api_key">
										<span class="dashicons dashicons-cloud" style="margin-right: 5px;"></span>
										<?php esc_html_e( 'Anthropic API Key', 'acf-block-builder' ); ?>
									</label>
									<div class="acf-block-builder-input-wrapper">
										<input type="password" id="acf_block_builder_anthropic_api_key" name="acf_block_builder_anthropic_api_key" value="<?php echo esc_attr( get_option( 'acf_block_builder_anthropic_api_key' ) ); ?>" placeholder="sk-ant-..." />
									</div>
									<p class="acf-block-builder-description">
										<?php echo wp_kses_post( __( 'For Claude models. Get your key from <a href="https://console.anthropic.com/settings/keys" target="_blank">Anthropic Console</a>.', 'acf-block-builder' ) ); ?>
									</p>
								</div>

								<div class="acf-block-builder-field-group">
									<label class="acf-block-builder-field-label" for="acf_block_builder_gemini_api_key">
										<span class="dashicons dashicons-google" style="margin-right: 5px;"></span>
										<?php esc_html_e( 'Google Gemini API Key', 'acf-block-builder' ); ?>
									</label>
									<div class="acf-block-builder-input-wrapper">
										<input type="password" id="acf_block_builder_gemini_api_key" name="acf_block_builder_gemini_api_key" value="<?php echo esc_attr( get_option( 'acf_block_builder_gemini_api_key' ) ); ?>" placeholder="AIza..." />
									</div>
									<p class="acf-block-builder-description">
										<?php echo wp_kses_post( __( 'For Gemini models. Get your key from <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a>.', 'acf-block-builder' ) ); ?>
									</p>
								</div>

								<div class="acf-block-builder-field-group">
									<label class="acf-block-builder-field-label" for="acf_block_builder_openai_api_key">
										<span class="dashicons dashicons-admin-site-alt3" style="margin-right: 5px;"></span>
										<?php esc_html_e( 'OpenAI API Key', 'acf-block-builder' ); ?>
									</label>
									<div class="acf-block-builder-input-wrapper">
										<input type="password" id="acf_block_builder_openai_api_key" name="acf_block_builder_openai_api_key" value="<?php echo esc_attr( get_option( 'acf_block_builder_openai_api_key' ) ); ?>" placeholder="sk-..." />
									</div>
									<p class="acf-block-builder-description">
										<?php echo wp_kses_post( __( 'For GPT and o1 models. Get your key from <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a>.', 'acf-block-builder' ) ); ?>
									</p>
								</div>

							</div>
						</div>

						<!-- Theme Integration Card -->
						<div class="acf-block-builder-card">
							<div class="acf-block-builder-card-header">
								<h2><?php esc_html_e( 'Theme Integration', 'acf-block-builder' ); ?></h2>
							</div>
							<div class="acf-block-builder-card-body">
								<div class="acf-block-builder-field-group">
									<label class="acf-block-builder-field-label"><?php esc_html_e( 'Theme Loader', 'acf-block-builder' ); ?></label>
									
									<?php if ( $this->is_theme_loader_installed() ) : ?>
										<div class="acf-block-builder-status-badge acf-block-builder-status-success">
											<span class="dashicons dashicons-yes-alt" style="font-size: 16px; width: 16px; height: 16px; margin-right: 4px;"></span>
											<?php esc_html_e( 'Installed', 'acf-block-builder' ); ?>
										</div>
										<p class="acf-block-builder-description">
											<?php esc_html_e( 'Theme loader is active. Blocks in your theme\'s "blocks" directory will be automatically loaded.', 'acf-block-builder' ); ?>
										</p>
									<?php else : ?>
										<button type="button" id="acf-block-builder-add-theme-loader" class="button button-secondary">
											<?php esc_html_e( 'Install Theme Loader', 'acf-block-builder' ); ?>
										</button>
										<p class="acf-block-builder-description">
											<?php esc_html_e( 'Add code to your active theme\'s functions.php to automatically load blocks from the "blocks" directory.', 'acf-block-builder' ); ?>
										</p>
									<?php endif; ?>
								</div>
							</div>
						</div>

						<!-- Custom Instructions Card -->
						<div class="acf-block-builder-card">
							<div class="acf-block-builder-card-header">
								<h2><?php esc_html_e( 'Custom Instructions', 'acf-block-builder' ); ?></h2>
							</div>
							<div class="acf-block-builder-card-body">
								<p class="acf-block-builder-description" style="margin-bottom: 20px;">
									<?php esc_html_e( 'Add custom instructions that will be sent with every request. Use this to enforce coding standards, CSS frameworks, or specific requirements.', 'acf-block-builder' ); ?>
								</p>
								<div class="acf-block-builder-field-group">
									<label class="acf-block-builder-field-label" for="acf_block_builder_custom_instructions">
										<?php esc_html_e( 'Global Prompt Instructions', 'acf-block-builder' ); ?>
									</label>
									<div class="acf-block-builder-input-wrapper">
										<textarea id="acf_block_builder_custom_instructions" name="acf_block_builder_custom_instructions" rows="5" class="large-text code" placeholder="e.g. Always use Tailwind CSS. Do not use jQuery."><?php echo esc_textarea( get_option( 'acf_block_builder_custom_instructions' ) ); ?></textarea>
									</div>
								</div>
							</div>
						</div>

						<!-- General Settings Card -->
						<div class="acf-block-builder-card">
							<div class="acf-block-builder-card-header">
								<h2><?php esc_html_e( 'Debugging', 'acf-block-builder' ); ?></h2>
							</div>
							<div class="acf-block-builder-card-body">
					

								<div class="acf-block-builder-field-group">
									<label class="acf-block-builder-field-label">
										<input type="checkbox" name="acf_block_builder_debug_enabled" value="1" <?php checked( 1, get_option( 'acf_block_builder_debug_enabled' ), true ); ?> />
										<?php esc_html_e( 'Enable Debug Mode', 'acf-block-builder' ); ?>
									</label>
								</div>

							</div>
						</div>
					</div>
				</div>

			</form>

			<script type="text/javascript">
			jQuery(document).ready(function($) {
				$('#acf-block-builder-add-theme-loader').on('click', function(e) {
					e.preventDefault();
					if (!confirm('<?php echo esc_js( __( 'This will append a PHP code snippet to your active theme\'s functions.php file. Continue?', 'acf-block-builder' ) ); ?>')) {
						return;
					}

					var $btn = $(this);
					$btn.prop('disabled', true);
					$btn.text('<?php echo esc_js( __( 'Installing...', 'acf-block-builder' ) ); ?>');

					$.ajax({
						url: ajaxurl,
						type: 'POST',
						data: {
							action: 'acf_block_builder_add_theme_loader',
							nonce: '<?php echo wp_create_nonce( 'acf_block_builder_settings' ); ?>'
						},
						success: function(response) {
							if (response.success) {
								location.reload();
							} else {
								alert('Error: ' + response.data);
								$btn.prop('disabled', false);
								$btn.text('<?php echo esc_js( __( 'Install Theme Loader', 'acf-block-builder' ) ); ?>');
							}
						},
						error: function() {
							alert('System Error');
							$btn.prop('disabled', false);
							$btn.text('<?php echo esc_js( __( 'Install Theme Loader', 'acf-block-builder' ) ); ?>');
						}
					});
				});
			});
			</script>
		</div>
		<?php
	}

	public function is_theme_loader_installed() {
		$theme_dir = get_stylesheet_directory();
		$functions_php = $theme_dir . '/functions.php';

		if ( ! file_exists( $functions_php ) ) {
			return false;
		}

		$content = file_get_contents( $functions_php );
		return strpos( $content, 'my_theme_register_acf_blocks' ) !== false;
	}

	public function handle_add_theme_loader() {
		check_ajax_referer( 'acf_block_builder_settings', 'nonce' );

		if ( ! current_user_can( 'edit_theme_options' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$theme_dir = get_stylesheet_directory();
		$functions_php = $theme_dir . '/functions.php';

		if ( ! file_exists( $functions_php ) ) {
			wp_send_json_error( 'functions.php not found in active theme.' );
		}

		$current_content = file_get_contents( $functions_php );

		// Simple check to avoid duplication
		if ( strpos( $current_content, 'my_theme_register_acf_blocks' ) !== false ) {
			wp_send_json_success( 'Loader code already exists in functions.php.' );
		}

		$loader_code = <<<PHP

/**
 * Automatically register all ACF Blocks from the 'blocks' directory.
 */
function my_theme_register_acf_blocks() {
    // Define the directory where blocks are stored
    \$blocks_dir = get_stylesheet_directory() . '/blocks';

    if ( file_exists( \$blocks_dir ) ) {
        // Find all subdirectories
        \$dirs = glob( \$blocks_dir . '/*', GLOB_ONLYDIR );
        
        if ( \$dirs ) {
            foreach ( \$dirs as \$dir ) {
                // 1. Register the block type from block.json
                if ( file_exists( \$dir . '/block.json' ) ) {
                    register_block_type( \$dir );
                }

                // 2. Load ACF Fields (if fields.php exists)
                if ( file_exists( \$dir . '/fields.php' ) ) {
                    require_once \$dir . '/fields.php';
                }

                // 3. Load Custom Assets logic (if assets.php exists)
                if ( file_exists( \$dir . '/assets.php' ) ) {
                    require_once \$dir . '/assets.php';
                }
            }
        }
    }
}
// Hook into 'init' to register blocks
add_action( 'init', 'my_theme_register_acf_blocks' );
PHP;

		if ( file_put_contents( $functions_php, $loader_code, FILE_APPEND ) === false ) {
			wp_send_json_error( 'Failed to write to functions.php.' );
		}

		wp_send_json_success( 'ACF Block Builder code has been added to functions.php successfully.' );
	}
}

new ACF_Block_Builder_Settings();

