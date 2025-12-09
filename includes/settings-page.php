<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACF_Block_Builder_Settings {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_settings_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'wp_ajax_acf_block_builder_add_theme_loader', array( $this, 'handle_add_theme_loader' ) );
	}

	public function add_settings_page() {
		add_submenu_page(
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
		register_setting( 'acf_block_builder_settings', 'acf_block_builder_debug_enabled' );
	}

	public function render_settings_page() {
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'ACF Block Builder Settings', 'acf-block-builder' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'acf_block_builder_settings' );
				do_settings_sections( 'acf_block_builder_settings' );
				?>
				<table class="form-table">
					<tr valign="top">
						<th scope="row"><?php echo esc_html__( 'Gemini API Key', 'acf-block-builder' ); ?></th>
						<td>
							<input type="password" name="acf_block_builder_gemini_api_key" value="<?php echo esc_attr( get_option( 'acf_block_builder_gemini_api_key' ) ); ?>" class="regular-text" />
							<p class="description">
								<?php echo wp_kses_post( __( 'Enter your Gemini API Key. You can get one from <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a>.', 'acf-block-builder' ) ); ?>
							</p>
						</td>
					</tr>
					<tr valign="top">
						<th scope="row"><?php echo esc_html__( 'Debug Mode', 'acf-block-builder' ); ?></th>
						<td>
							<input type="checkbox" name="acf_block_builder_debug_enabled" value="1" <?php checked( 1, get_option( 'acf_block_builder_debug_enabled' ), true ); ?> />
							<p class="description">
								<?php echo esc_html__( 'Enable debug logging for the plugin updater.', 'acf-block-builder' ); ?>
							</p>
						</td>
					</tr>
				</table>
				
				<hr>
				
				<h2><?php esc_html_e( 'Theme Integration', 'acf-block-builder' ); ?></h2>
				<table class="form-table">
					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Theme Loader', 'acf-block-builder' ); ?></th>
						<td>
							<?php if ( $this->is_theme_loader_installed() ) : ?>
								<div class="notice notice-success inline" style="margin: 0;">
									<p>
										<span class="dashicons dashicons-yes-alt" style="color: green;"></span>
										<?php esc_html_e( 'Theme loader is installed. Blocks in your theme\'s "blocks" directory will be automatically loaded.', 'acf-block-builder' ); ?>
									</p>
								</div>
							<?php else : ?>
								<button type="button" id="acf-block-builder-add-theme-loader" class="button button-secondary">
									<?php esc_html_e( 'Install Theme Loader', 'acf-block-builder' ); ?>
								</button>
								<p class="description">
									<?php esc_html_e( 'Add code to your active theme\'s functions.php to automatically load blocks from the "blocks" directory.', 'acf-block-builder' ); ?>
								</p>
							<?php endif; ?>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
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

					$.ajax({
						url: ajaxurl,
						type: 'POST',
						data: {
							action: 'acf_block_builder_add_theme_loader',
							nonce: '<?php echo wp_create_nonce( 'acf_block_builder_settings' ); ?>'
						},
						success: function(response) {
							if (response.success) {
								alert(response.data);
								location.reload();
							} else {
								alert('Error: ' + response.data);
								$btn.prop('disabled', false);
							}
						},
						error: function() {
							alert('System Error');
							$btn.prop('disabled', false);
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

		wp_send_json_success( 'Loader code added to functions.php successfully.' );
	}
}

new ACF_Block_Builder_Settings();

