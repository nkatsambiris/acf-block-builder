<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACF_Block_Builder_Revisions {

	// List of meta keys we want to version control
	private $meta_keys = array(
		'_acf_block_builder_json',
		'_acf_block_builder_php',
		'_acf_block_builder_css',
		'_acf_block_builder_js',
		'_acf_block_builder_fields',
		'_acf_block_builder_assets',
		'_acf_block_builder_prompt', // Optional: version control the AI prompt too
	);

	public function __construct() {
		// 1. Save custom fields to the revision
		add_action( 'save_post', array( $this, 'save_revision_meta' ), 10, 2 );
		
		// 2. Restore custom fields from the revision
		add_action( 'wp_restore_post_revision', array( $this, 'restore_revision_meta' ), 10, 2 );

		// 3. Inject code into the main content so the "Compare Revisions" UI works like GitHub
		add_filter( 'wp_insert_post_data', array( $this, 'inject_content_for_diff' ), 10, 2 );
	}

	/**
	 * Saves the block meta data to the revision post.
	 */
	public function save_revision_meta( $post_id, $post ) {
		// Only run for revisions
		if ( $post->post_type !== 'revision' ) {
			return;
		}

		$parent_id = $post->post_parent;
		$parent_post = get_post( $parent_id );

		// Only run for our block builder post type
		if ( ! $parent_post || $parent_post->post_type !== 'acf_block_builder' ) {
			return;
		}

		// Loop through our keys and save them to the revision
		foreach ( $this->meta_keys as $meta_key ) {
			// Remove leading underscore for $_POST lookup (e.g. _acf... -> acf...)
			$input_name = ltrim( $meta_key, '_' );

			if ( isset( $_POST[ $input_name ] ) ) {
				// If saving from editor, use POST data
				update_metadata( 'post', $post_id, $meta_key, wp_unslash( $_POST[ $input_name ] ) );
			} else {
				// Fallback: Copy from parent if not in POST
				$value = get_post_meta( $parent_id, $meta_key, true );
				if ( false !== $value ) {
					update_metadata( 'post', $post_id, $meta_key, $value );
				}
			}
		}
	}

	/**
	 * Restores the block meta data from the revision to the parent post.
	 */
	public function restore_revision_meta( $post_id, $revision_id ) {
		$post = get_post( $post_id );
		if ( $post->post_type !== 'acf_block_builder' ) {
			return;
		}

		foreach ( $this->meta_keys as $meta_key ) {
			$revision_value = get_metadata( 'post', $revision_id, $meta_key, true );
			
			if ( false !== $revision_value ) {
				update_post_meta( $post_id, $meta_key, $revision_value );
			}
		}

		// Trigger file regeneration immediately after restore
		if ( class_exists( 'ACF_Block_Builder_Meta_Boxes' ) ) {
			$meta_box_handler = new ACF_Block_Builder_Meta_Boxes();
			if ( method_exists( $meta_box_handler, 'generate_block_files' ) ) {
				$meta_box_handler->generate_block_files( $post_id );
			}
		}
	}

	/**
	 * Prepares a "virtual" content body for the Revision UI.
	 * This allows the native WordPress diff viewer to show changes for all files.
	 */
	public function inject_content_for_diff( $data, $postarr ) {
		if ( $data['post_type'] === 'acf_block_builder' ) {
			$content_map = [
				'BLOCK.JSON' => 'acf_block_builder_json',
				'RENDER.PHP' => 'acf_block_builder_php',
				'STYLE.CSS'  => 'acf_block_builder_css',
				'SCRIPT.JS'  => 'acf_block_builder_js',
				'FIELDS.PHP' => 'acf_block_builder_fields',
				'ASSETS.PHP' => 'acf_block_builder_assets',
			];

			$virtual_content = "";

			foreach ( $content_map as $label => $field_key ) {
				// Check $_POST first (saving), then fall back to existing DB (updating other meta)
				$val = isset( $_POST[ $field_key ] ) ? wp_unslash( $_POST[ $field_key ] ) : '';
				
				// Clean up whitespace
				$val = trim( $val );

				if ( ! empty( $val ) ) {
					$virtual_content .= "<!-- **************************************** -->\n";
					$virtual_content .= "<!-- FILE: $label -->\n";
					$virtual_content .= "<!-- **************************************** -->\n";
					$virtual_content .= $val . "\n\n";
				}
			}

			// Save this virtual content to post_content (which is otherwise unused for this CPT)
			// strictly for the purpose of the Revisions UI.
			$data['post_content'] = $virtual_content;
		}
		return $data;
	}
}

new ACF_Block_Builder_Revisions();

