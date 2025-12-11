<?php
/**
* Plugin Name: ACF Block Builder
* Description: A tool to easily create and manage ACF Blocks using AI and an internal code editor.
* Version: 1.2.0
* Author: Nicholas Katsambiris
* Update URI: acf-block-builder
* License: MIT
* Tested up to: 6.9
* Requires at least: 6.3
* Requires PHP: 8.0
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ACF_BLOCK_BUILDER_PATH', plugin_dir_path( __FILE__ ) );
define( 'ACF_BLOCK_BUILDER_URL', plugin_dir_url( __FILE__ ) );
define( 'ACF_BLOCK_BUILDER_FILE', __FILE__ );
define( 'ACF_BLOCK_BUILDER_VERSION', '1.2.0' );

class ACF_Block_Builder {

	public function __construct() {
		add_action( 'init', array( $this, 'register_post_type' ) );
		add_action( 'init', array( $this, 'register_acf_blocks' ) );
		add_action( 'acf/init', array( $this, 'register_acf_fields' ) );
		
		// Create uploads directory if it doesn't exist
		add_action( 'admin_init', array( $this, 'create_uploads_directory' ) );

		// Plugin updater
		require_once ACF_BLOCK_BUILDER_PATH . 'includes/plugin-updater.php';
		// Load settings
		require_once ACF_BLOCK_BUILDER_PATH . 'includes/settings-page.php';
		// Load Meta Boxes
		require_once ACF_BLOCK_BUILDER_PATH . 'includes/meta-boxes.php';
		// Load Revisions Handler
		require_once ACF_BLOCK_BUILDER_PATH . 'includes/revisions-handler.php';
		// Load File Versions Handler (per-file version control)
		require_once ACF_BLOCK_BUILDER_PATH . 'includes/file-versions.php';
		// Load AI Handler
		require_once ACF_BLOCK_BUILDER_PATH . 'includes/ai-handler.php';

		// ACF JSON Sync
		add_filter( 'acf/settings/load_json', array( $this, 'add_json_load_paths' ) );
		add_filter( 'acf/settings/save_json', array( $this, 'set_json_save_path' ) );
	}

	public function add_json_load_paths( $paths ) {
		$upload_dir = wp_upload_dir();
		$blocks_dir = $upload_dir['basedir'] . '/acf-blocks';
		if ( ! file_exists( $blocks_dir ) ) {
			return $paths;
		}

		$dirs = glob( $blocks_dir . '/*', GLOB_ONLYDIR );
		if ( $dirs ) {
			foreach ( $dirs as $dir ) {
				$block_folder_name = basename( $dir );
				$post = $this->get_block_post_by_slug( $block_folder_name );
				
				if ( $post ) {
					$is_active = get_post_meta( $post->ID, '_acf_block_builder_active', true );
					if ( '0' === $is_active ) {
						continue;
					}

					$is_sync = get_post_meta( $post->ID, '_acf_block_builder_json_sync', true );
					if ( '1' === $is_sync ) {
						$paths[] = $dir;
					}
				}
			}
		}

		return $paths;
	}

	public function set_json_save_path( $path ) {
		// Only check if we are possibly saving an ACF field group
		if ( ! isset( $_POST['acf_field_group']['key'] ) ) {
			return $path;
		}

		$group_key = sanitize_text_field( $_POST['acf_field_group']['key'] );
		$upload_dir = wp_upload_dir();
		$blocks_dir = $upload_dir['basedir'] . '/acf-blocks';

		if ( ! file_exists( $blocks_dir ) ) {
			return $path;
		}

		$dirs = glob( $blocks_dir . '/*', GLOB_ONLYDIR );
		if ( $dirs ) {
			foreach ( $dirs as $dir ) {
				// We need to check if this block has sync enabled AND if the group key matches the JSON file in this dir
				$block_folder_name = basename( $dir );
				$post = $this->get_block_post_by_slug( $block_folder_name );

				if ( $post ) {
					$is_sync = get_post_meta( $post->ID, '_acf_block_builder_json_sync', true );
					if ( '1' !== $is_sync ) {
						continue;
					}

					// Check if JSON file exists and contains the key
					// ACF saves files as group_key.json usually, but let's check content or filename
					// Actually, ACF saves as {key}.json.
					$json_file = $dir . '/' . $group_key . '.json';
					if ( file_exists( $json_file ) ) {
						return $dir;
					}

					// Fallback: Check if ANY json file in this dir has this key (if filename is different for some reason)
					// But standard ACF behavior is key.json
					// Also, if it's a NEW save (initial sync), we might need to check if the group key matches what we generated in fields.php
					// But fields.php is PHP.
					// If we enabled sync, we should have generated the JSON file.
				}
			}
		}

		return $path;
	}

	private function get_block_post_by_slug( $slug ) {
		$args = array(
			'name'        => $slug,
			'post_type'   => 'acf_block_builder',
			'post_status' => 'any',
			'numberposts' => 1
		);
		$posts = get_posts( $args );
		return $posts ? $posts[0] : null;
	}

	public function create_uploads_directory() {
		$upload_dir = wp_upload_dir();
		$blocks_dir = $upload_dir['basedir'] . '/acf-blocks';

		if ( ! file_exists( $blocks_dir ) ) {
			wp_mkdir_p( $blocks_dir );
		}
	}

	public function register_acf_blocks() {
		$upload_dir = wp_upload_dir();
		$blocks_dir = $upload_dir['basedir'] . '/acf-blocks';

		if ( file_exists( $blocks_dir ) ) {
			// Register blocks by iterating through subdirectories
			$dirs = glob( $blocks_dir . '/*', GLOB_ONLYDIR );
			if ( $dirs ) {
				foreach ( $dirs as $dir ) {
					// register_block_type fails to resolve URLs correctly for blocks in 'uploads'.
					// We must manually parse block.json, register assets with correct URLs, and pass handles.
					$block_json_path = $dir . '/block.json';
					if ( ! file_exists( $block_json_path ) ) {
						continue;
					}

					// Load Custom Assets File if it exists (assets.php)
					if ( file_exists( $dir . '/assets.php' ) ) {
						require_once $dir . '/assets.php';
					}

					$metadata = json_decode( file_get_contents( $block_json_path ), true );
					if ( ! $metadata ) {
						continue;
					}

					$args = array();
					$block_folder_name = basename( $dir );
					
					// Check if block is active
					$active_check_args = array(
						'name'        => $block_folder_name,
						'post_type'   => 'acf_block_builder',
						'post_status' => 'any',
						'numberposts' => 1
					);
					$active_check_posts = get_posts( $active_check_args );
					if ( $active_check_posts ) {
						$is_active = get_post_meta( $active_check_posts[0]->ID, '_acf_block_builder_active', true );
						// If explicitly disabled (saved as '0'), skip. Default is active.
						if ( '0' === $is_active ) {
							continue;
						}
					}

					$block_url = $upload_dir['baseurl'] . '/acf-blocks/' . $block_folder_name;

					// Handle Style
					if ( isset( $metadata['style'] ) ) {
						$styles = (array) $metadata['style'];
						foreach ( $styles as $style_path ) {
							if ( is_string( $style_path ) && strpos( $style_path, 'file:' ) === 0 ) {
								$filename = str_replace( array( 'file:./', 'file:' ), '', $style_path );
								$handle   = 'acf-block-' . $block_folder_name . '-style';
								$file_url = $block_url . '/' . $filename;
								$file_path = $dir . '/' . $filename;

								if ( file_exists( $file_path ) ) {
									wp_register_style( $handle, $file_url, array(), filemtime( $file_path ) );
									// Only one style handle can be passed to register_block_type as string, 
									// or an array of handles. We'll simplify to just overriding the first one found or adding to array.
									// For simplicity in this fix, we replace the args['style'] with our handle.
									$args['style'] = $handle;
								}
							}
						}
					}

					// Handle Script
					if ( isset( $metadata['script'] ) ) {
						$scripts = (array) $metadata['script'];
						foreach ( $scripts as $script_path ) {
							if ( is_string( $script_path ) && strpos( $script_path, 'file:' ) === 0 ) {
								$filename = str_replace( array( 'file:./', 'file:' ), '', $script_path );
								$handle   = 'acf-block-' . $block_folder_name . '-script';
								$file_url = $block_url . '/' . $filename;
								$file_path = $dir . '/' . $filename;

							if ( file_exists( $file_path ) ) {
								// Add jQuery as dependency
								wp_register_script( $handle, $file_url, array( 'jquery' ), filemtime( $file_path ), true );
								$args['script'] = $handle;
							}
							}
						}
					}

					register_block_type( $dir, $args );
				}
			}
		}
	}

	public function register_acf_fields() {
		$upload_dir = wp_upload_dir();
		$blocks_dir = $upload_dir['basedir'] . '/acf-blocks';

		if ( file_exists( $blocks_dir ) ) {
			// Load field definitions (fields.php) for each block
			$dirs = glob( $blocks_dir . '/*', GLOB_ONLYDIR );
			if ( $dirs ) {
				foreach ( $dirs as $dir ) {
					// Check if block is active (same logic as register_acf_blocks)
					$block_folder_name = basename( $dir );
					$active_check_args = array(
						'name'        => $block_folder_name,
						'post_type'   => 'acf_block_builder',
						'post_status' => 'any',
						'numberposts' => 1
					);
					$active_check_posts = get_posts( $active_check_args );
					if ( $active_check_posts ) {
						$is_active = get_post_meta( $active_check_posts[0]->ID, '_acf_block_builder_active', true );
						if ( '0' === $is_active ) {
							continue;
						}

						// Check for JSON Sync
						$is_sync = get_post_meta( $active_check_posts[0]->ID, '_acf_block_builder_json_sync', true );
						if ( '1' === $is_sync ) {
							// Skip requiring fields.php if sync is enabled
							// ACF will load from JSON via 'add_json_load_paths'
							continue;
						}
					}

					if ( file_exists( $dir . '/fields.php' ) ) {
						require_once $dir . '/fields.php';
					}
				}
			}
		}
	}

	public function register_post_type() {
		register_post_type( 'acf_block_builder', array(
			'labels' => array(
				'name'               => __( 'ACF Blocks', 'acf-block-builder' ),
				'singular_name'      => __( 'ACF Block', 'acf-block-builder' ),
				'add_new'            => __( 'Add New Block', 'acf-block-builder' ),
				'add_new_item'       => __( 'Add New ACF Block', 'acf-block-builder' ),
				'edit_item'          => __( 'Edit ACF Block', 'acf-block-builder' ),
				'new_item'           => __( 'New ACF Block', 'acf-block-builder' ),
				'view_item'          => __( 'View ACF Block', 'acf-block-builder' ),
				'search_items'       => __( 'Search ACF Blocks', 'acf-block-builder' ),
				'not_found'          => __( 'No ACF Blocks found', 'acf-block-builder' ),
				'not_found_in_trash' => __( 'No ACF Blocks found in Trash', 'acf-block-builder' ),
			),
			'public'      => false,
			'show_ui'     => true,
			'show_in_menu'=> true,
			'supports'    => array( 'title', 'revisions' ), // We will add custom metaboxes for description/AI prompts
			'menu_icon'   => 'dashicons-layout',
		));
	}
}

function acf_block_builder_init() {
	// Check if ACF is active
	if ( ! class_exists( 'ACF' ) ) {
		add_action( 'admin_notices', 'acf_block_builder_notice_missing_acf' );
		return;
	}

	// Check if ACF PRO is active
	if ( ! defined( 'ACF_PRO' ) || ! ACF_PRO ) {
		add_action( 'admin_notices', 'acf_block_builder_notice_missing_pro' );
		return;
	}

	// Check ACF Version
	if ( defined( 'ACF_VERSION' ) && version_compare( ACF_VERSION, '6.7.0', '<' ) ) {
		add_action( 'admin_notices', 'acf_block_builder_notice_version' );
		return;
	}

	new ACF_Block_Builder();
}
add_action( 'plugins_loaded', 'acf_block_builder_init' );

function acf_block_builder_notice_missing_acf() {
	?>
	<div class="notice notice-error is-dismissible">
		<p><?php _e( 'ACF Block Builder requires Advanced Custom Fields PRO to be installed and active.', 'acf-block-builder' ); ?></p>
	</div>
	<?php
}

function acf_block_builder_notice_missing_pro() {
	?>
	<div class="notice notice-error is-dismissible">
		<p><?php _e( 'ACF Block Builder requires Advanced Custom Fields PRO. You are currently using the free version.', 'acf-block-builder' ); ?></p>
	</div>
	<?php
}

function acf_block_builder_notice_version() {
	?>
	<div class="notice notice-error is-dismissible">
		<p><?php _e( 'ACF Block Builder requires Advanced Custom Fields PRO version 6.7.0 or greater.', 'acf-block-builder' ); ?></p>
	</div>
	<?php
}

// Plugin activation hook - create file versions table
register_activation_hook( ACF_BLOCK_BUILDER_FILE, 'acf_block_builder_activate' );
function acf_block_builder_activate() {
	// Create file versions database table
	if ( function_exists( 'acf_block_builder_activate_file_versions' ) ) {
		acf_block_builder_activate_file_versions();
	} else {
		// Include the file if not already loaded
		require_once plugin_dir_path( ACF_BLOCK_BUILDER_FILE ) . 'includes/file-versions.php';
		ACF_Block_Builder_File_Versions::create_table();
	}
}
