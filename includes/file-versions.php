<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACF_Block_Builder_File_Versions {

	private $table_name;
	
	private $file_types = array(
		'json'   => '_acf_block_builder_json',
		'php'    => '_acf_block_builder_php',
		'css'    => '_acf_block_builder_css',
		'js'     => '_acf_block_builder_js',
		'fields' => '_acf_block_builder_fields',
		'assets' => '_acf_block_builder_assets',
	);

	private $file_labels = array(
		'json'   => 'block.json',
		'php'    => 'render.php',
		'css'    => 'style.css',
		'js'     => 'script.js',
		'fields' => 'fields.php',
		'assets' => 'assets.php',
	);

	public function __construct() {
		global $wpdb;
		$this->table_name = $wpdb->prefix . 'acf_block_file_versions';

		// AJAX handlers
		add_action( 'wp_ajax_acf_bb_get_file_versions', array( $this, 'ajax_get_file_versions' ) );
		add_action( 'wp_ajax_acf_bb_get_version_content', array( $this, 'ajax_get_version_content' ) );
		add_action( 'wp_ajax_acf_bb_get_version_diff', array( $this, 'ajax_get_version_diff' ) );
		add_action( 'wp_ajax_acf_bb_restore_file_version', array( $this, 'ajax_restore_file_version' ) );
		add_action( 'wp_ajax_acf_bb_get_all_file_versions', array( $this, 'ajax_get_all_file_versions' ) );
	}

	/**
	 * Create the database table on plugin activation
	 */
	public static function create_table() {
		global $wpdb;
		$table_name = $wpdb->prefix . 'acf_block_file_versions';
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE $table_name (
			id bigint(20) NOT NULL AUTO_INCREMENT,
			post_id bigint(20) NOT NULL,
			file_type varchar(50) NOT NULL,
			content longtext NOT NULL,
			content_hash varchar(64) NOT NULL,
			version_number int(11) NOT NULL,
			user_id bigint(20) NOT NULL,
			created_at datetime DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY post_file_idx (post_id, file_type),
			KEY post_version_idx (post_id, version_number),
			KEY content_hash_idx (post_id, file_type, content_hash)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Store version for future migrations
		update_option( 'acf_block_file_versions_db_version', '1.0' );
	}

	/**
	 * Check if table exists and create if not
	 */
	public function maybe_create_table() {
		global $wpdb;
		
		$table_exists = $wpdb->get_var( 
			$wpdb->prepare( 
				"SHOW TABLES LIKE %s", 
				$this->table_name 
			) 
		) === $this->table_name;

		if ( ! $table_exists ) {
			self::create_table();
		}
	}

	/**
	 * Save versions for files that have changed
	 */
	public function save_file_versions( $post_id ) {
		global $wpdb;
		
		// Ensure table exists
		$this->maybe_create_table();

		$user_id = get_current_user_id();
		$changes_made = array();

		foreach ( $this->file_types as $type => $meta_key ) {
			$content = get_post_meta( $post_id, $meta_key, true );
			
			// Skip empty content
			if ( empty( $content ) ) {
				continue;
			}

			$content_hash = md5( $content );

			// Get latest version for this file
			$last_version = $this->get_latest_version( $post_id, $type );

			// Only save if content actually changed
			if ( ! $last_version || $last_version->content_hash !== $content_hash ) {
				$version_number = $last_version ? $last_version->version_number + 1 : 1;

				$wpdb->insert(
					$this->table_name,
					array(
						'post_id'        => $post_id,
						'file_type'      => $type,
						'content'        => $content,
						'content_hash'   => $content_hash,
						'version_number' => $version_number,
						'user_id'        => $user_id,
					),
					array( '%d', '%s', '%s', '%s', '%d', '%d' )
				);

				$changes_made[] = $type;
			}
		}

		// Prune old versions after saving
		if ( ! empty( $changes_made ) ) {
			$this->prune_old_versions( $post_id );
		}

		return $changes_made;
	}

	/**
	 * Get the latest version for a specific file
	 */
	public function get_latest_version( $post_id, $file_type ) {
		global $wpdb;

		return $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name}
				WHERE post_id = %d AND file_type = %s
				ORDER BY version_number DESC
				LIMIT 1",
				$post_id,
				$file_type
			)
		);
	}

	/**
	 * Get version history for a specific file
	 */
	public function get_file_versions( $post_id, $file_type, $limit = 50 ) {
		global $wpdb;

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT v.id, v.post_id, v.file_type, v.content_hash, v.version_number, 
				        v.user_id, v.created_at, u.display_name as author_name
				FROM {$this->table_name} v
				LEFT JOIN {$wpdb->users} u ON v.user_id = u.ID
				WHERE v.post_id = %d AND v.file_type = %s
				ORDER BY v.version_number DESC
				LIMIT %d",
				$post_id,
				$file_type,
				$limit
			)
		);
	}

	/**
	 * Get all file versions for a post (grouped by file type)
	 */
	public function get_all_file_versions( $post_id, $limit_per_file = 20 ) {
		$all_versions = array();

		foreach ( $this->file_types as $type => $meta_key ) {
			$versions = $this->get_file_versions( $post_id, $type, $limit_per_file );
			if ( ! empty( $versions ) ) {
				$all_versions[ $type ] = array(
					'label'    => $this->file_labels[ $type ],
					'versions' => $versions,
				);
			}
		}

		return $all_versions;
	}

	/**
	 * Get specific version content
	 */
	public function get_version_content( $version_id ) {
		global $wpdb;

		return $wpdb->get_row(
			$wpdb->prepare(
				"SELECT v.*, u.display_name as author_name
				FROM {$this->table_name} v
				LEFT JOIN {$wpdb->users} u ON v.user_id = u.ID
				WHERE v.id = %d",
				$version_id
			)
		);
	}

	/**
	 * Restore file to specific version
	 */
	public function restore_version( $post_id, $version_id ) {
		$version = $this->get_version_content( $version_id );
		
		if ( ! $version || (int) $version->post_id !== (int) $post_id ) {
			return false;
		}

		$meta_key = $this->file_types[ $version->file_type ] ?? null;
		if ( ! $meta_key ) {
			return false;
		}

		// Update the post meta
		update_post_meta( $post_id, $meta_key, $version->content );

		// Save this restoration as a new version
		$this->save_file_versions( $post_id );

		// Regenerate block files
		if ( class_exists( 'ACF_Block_Builder_Meta_Boxes' ) ) {
			$meta_box_handler = new ACF_Block_Builder_Meta_Boxes();
			if ( method_exists( $meta_box_handler, 'generate_block_files' ) ) {
				$meta_box_handler->generate_block_files( $post_id );
			}
		}

		return array(
			'file_type' => $version->file_type,
			'content'   => $version->content,
			'label'     => $this->file_labels[ $version->file_type ],
		);
	}

	/**
	 * Prune old versions to prevent database bloat
	 * Keeps the most recent N versions per file
	 */
	public function prune_old_versions( $post_id, $keep = 30 ) {
		global $wpdb;

		foreach ( array_keys( $this->file_types ) as $type ) {
			// Get IDs to keep
			$keep_ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT id FROM {$this->table_name}
					WHERE post_id = %d AND file_type = %s
					ORDER BY version_number DESC
					LIMIT %d",
					$post_id,
					$type,
					$keep
				)
			);

			if ( ! empty( $keep_ids ) ) {
				$keep_ids_str = implode( ',', array_map( 'intval', $keep_ids ) );
				
				$wpdb->query(
					$wpdb->prepare(
						"DELETE FROM {$this->table_name}
						WHERE post_id = %d AND file_type = %s AND id NOT IN ($keep_ids_str)",
						$post_id,
						$type
					)
				);
			}
		}
	}

	/**
	 * Delete all versions for a post (used when post is deleted)
	 */
	public function delete_post_versions( $post_id ) {
		global $wpdb;

		$wpdb->delete(
			$this->table_name,
			array( 'post_id' => $post_id ),
			array( '%d' )
		);
	}

	/**
	 * Get version count per file for a post
	 */
	public function get_version_counts( $post_id ) {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT file_type, COUNT(*) as count, MAX(version_number) as latest_version
				FROM {$this->table_name}
				WHERE post_id = %d
				GROUP BY file_type",
				$post_id
			),
			OBJECT_K
		);

		$counts = array();
		foreach ( $this->file_types as $type => $meta_key ) {
			$counts[ $type ] = array(
				'count'          => isset( $results[ $type ] ) ? (int) $results[ $type ]->count : 0,
				'latest_version' => isset( $results[ $type ] ) ? (int) $results[ $type ]->latest_version : 0,
				'label'          => $this->file_labels[ $type ],
			);
		}

		return $counts;
	}

	// ==========================================
	// AJAX HANDLERS
	// ==========================================

	/**
	 * AJAX: Get file versions for a specific file type
	 */
	public function ajax_get_file_versions() {
		check_ajax_referer( 'acf_block_builder_versions', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$post_id   = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
		$file_type = isset( $_POST['file_type'] ) ? sanitize_key( $_POST['file_type'] ) : '';

		if ( ! $post_id || ! $file_type ) {
			wp_send_json_error( 'Missing parameters.' );
		}

		if ( ! array_key_exists( $file_type, $this->file_types ) ) {
			wp_send_json_error( 'Invalid file type.' );
		}

		$versions = $this->get_file_versions( $post_id, $file_type );

		wp_send_json_success( array(
			'versions'  => $versions,
			'file_type' => $file_type,
			'label'     => $this->file_labels[ $file_type ],
		) );
	}

	/**
	 * AJAX: Get all file versions for a post
	 */
	public function ajax_get_all_file_versions() {
		check_ajax_referer( 'acf_block_builder_versions', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;

		if ( ! $post_id ) {
			wp_send_json_error( 'Missing post ID.' );
		}

		$all_versions = $this->get_all_file_versions( $post_id );
		$counts = $this->get_version_counts( $post_id );

		wp_send_json_success( array(
			'versions' => $all_versions,
			'counts'   => $counts,
		) );
	}

	/**
	 * AJAX: Get specific version content
	 */
	public function ajax_get_version_content() {
		check_ajax_referer( 'acf_block_builder_versions', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$version_id = isset( $_POST['version_id'] ) ? intval( $_POST['version_id'] ) : 0;

		if ( ! $version_id ) {
			wp_send_json_error( 'Missing version ID.' );
		}

		$version = $this->get_version_content( $version_id );

		if ( ! $version ) {
			wp_send_json_error( 'Version not found.' );
		}

		wp_send_json_success( array(
			'version' => $version,
			'label'   => $this->file_labels[ $version->file_type ],
		) );
	}

	/**
	 * AJAX: Get two versions for diff comparison
	 */
	public function ajax_get_version_diff() {
		check_ajax_referer( 'acf_block_builder_versions', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$version_a = isset( $_POST['version_a'] ) ? intval( $_POST['version_a'] ) : 0;
		$version_b = isset( $_POST['version_b'] ) ? intval( $_POST['version_b'] ) : 0;

		if ( ! $version_a || ! $version_b ) {
			wp_send_json_error( 'Missing version IDs.' );
		}

		$original = $this->get_version_content( $version_a );
		$modified = $this->get_version_content( $version_b );

		if ( ! $original || ! $modified ) {
			wp_send_json_error( 'One or both versions not found.' );
		}

		// Ensure both versions are for the same file type
		if ( $original->file_type !== $modified->file_type ) {
			wp_send_json_error( 'Cannot compare different file types.' );
		}

		wp_send_json_success( array(
			'original' => $original,
			'modified' => $modified,
			'label'    => $this->file_labels[ $original->file_type ],
		) );
	}

	/**
	 * AJAX: Restore file to specific version
	 */
	public function ajax_restore_file_version() {
		check_ajax_referer( 'acf_block_builder_versions', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$post_id    = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
		$version_id = isset( $_POST['version_id'] ) ? intval( $_POST['version_id'] ) : 0;

		if ( ! $post_id || ! $version_id ) {
			wp_send_json_error( 'Missing parameters.' );
		}

		$result = $this->restore_version( $post_id, $version_id );

		if ( $result ) {
			wp_send_json_success( array(
				'message'   => sprintf( __( 'Restored %s successfully.', 'acf-block-builder' ), $result['label'] ),
				'file_type' => $result['file_type'],
				'content'   => $result['content'],
			) );
		} else {
			wp_send_json_error( 'Failed to restore version.' );
		}
	}

	/**
	 * Get file types mapping (for external use)
	 */
	public function get_file_types() {
		return $this->file_types;
	}

	/**
	 * Get file labels mapping (for external use)
	 */
	public function get_file_labels() {
		return $this->file_labels;
	}
}

// Initialize the class
new ACF_Block_Builder_File_Versions();

/**
 * Ensure database table exists on admin init
 * This handles upgrades where the activation hook wouldn't fire
 */
add_action( 'admin_init', function() {
	// Only check once per day to avoid overhead
	$last_check = get_option( 'acf_block_file_versions_table_check', 0 );
	$one_day = 86400;
	
	if ( time() - $last_check > $one_day ) {
		$handler = new ACF_Block_Builder_File_Versions();
		$handler->maybe_create_table();
		update_option( 'acf_block_file_versions_table_check', time() );
	}
} );

/**
 * Plugin activation hook to create the table
 */
function acf_block_builder_activate_file_versions() {
	ACF_Block_Builder_File_Versions::create_table();
}

/**
 * Clean up versions when a block post is deleted
 */
add_action( 'before_delete_post', function( $post_id ) {
	$post = get_post( $post_id );
	if ( $post && $post->post_type === 'acf_block_builder' ) {
		$handler = new ACF_Block_Builder_File_Versions();
		$handler->delete_post_versions( $post_id );
	}
} );

