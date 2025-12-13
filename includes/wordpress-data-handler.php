<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'ACF_Block_Builder_WordPress_Data' ) ) :

class ACF_Block_Builder_WordPress_Data {

	public function __construct() {
		add_action( 'wp_ajax_acf_block_builder_get_wp_data', array( $this, 'handle_get_wp_data' ) );
	}

	/**
	 * AJAX handler to return WordPress data structures for @mention autocomplete.
	 * Returns post types, taxonomies, ACF field groups, and individual fields.
	 */
	public function handle_get_wp_data() {
		check_ajax_referer( 'acf_block_builder_ai', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$data = array(
			'postTypes'   => $this->get_post_types(),
			'taxonomies'  => $this->get_taxonomies(),
			'fieldGroups' => $this->get_field_groups(),
			'fields'      => $this->get_fields(),
			'posts'       => $this->get_posts_by_type(),
		);

		wp_send_json_success( $data );
	}

	/**
	 * Get all public post types with their metadata.
	 * 
	 * @return array Array of post type data
	 */
	private function get_post_types() {
		$post_types = get_post_types(
			array(
				'public' => true,
			),
			'objects'
		);

		$result = array();

		foreach ( $post_types as $post_type ) {
			// Get taxonomies for this post type
			$taxonomies = get_object_taxonomies( $post_type->name, 'names' );
			
			// Get supports
			$supports = array();
			$all_supports = get_all_post_type_supports( $post_type->name );
			if ( $all_supports ) {
				$supports = array_keys( $all_supports );
			}

			$result[] = array(
				'id'           => $post_type->name,
				'label'        => $post_type->label,
				'singular'     => $post_type->labels->singular_name,
				'description'  => $post_type->description ?: '',
				'hierarchical' => (bool) $post_type->hierarchical,
				'supports'     => $supports,
				'taxonomies'   => $taxonomies,
				'rest_base'    => $post_type->rest_base ?: $post_type->name,
			);
		}

		return $result;
	}

	/**
	 * Get posts grouped by post type for nested navigation.
	 * 
	 * @return array Array of posts grouped by post type
	 */
	private function get_posts_by_type() {
		$post_types = get_post_types(
			array(
				'public' => true,
			),
			'objects'
		);

		$result = array();

		foreach ( $post_types as $post_type ) {
			// Skip attachments for now - handle separately for better UX
			$posts_per_page = $post_type->name === 'attachment' ? 50 : 100;
			
			$query_args = array(
				'post_type'      => $post_type->name,
				'posts_per_page' => $posts_per_page,
				'post_status'    => $post_type->name === 'attachment' ? 'inherit' : 'publish',
				'orderby'        => 'title',
				'order'          => 'ASC',
			);

			$posts = get_posts( $query_args );
			$post_list = array();

			foreach ( $posts as $post ) {
				$post_data = array(
					'id'    => $post->ID,
					'title' => $post->post_title ?: '(No title)',
					'slug'  => $post->post_name,
					'url'   => get_permalink( $post->ID ),
				);

				// Add thumbnail for attachments
				if ( $post_type->name === 'attachment' ) {
					$post_data['mime_type'] = $post->post_mime_type;
					$thumb_url = wp_get_attachment_image_url( $post->ID, 'thumbnail' );
					if ( $thumb_url ) {
						$post_data['thumbnail'] = $thumb_url;
					}
				}

				$post_list[] = $post_data;
			}

			$result[ $post_type->name ] = array(
				'label'  => $post_type->label,
				'singular' => $post_type->labels->singular_name,
				'posts'  => $post_list,
				'count'  => wp_count_posts( $post_type->name )->publish ?? count( $post_list ),
			);
		}

		return $result;
	}

	/**
	 * Get all public taxonomies with their metadata.
	 * 
	 * @return array Array of taxonomy data
	 */
	private function get_taxonomies() {
		$taxonomies = get_taxonomies(
			array(
				'public' => true,
			),
			'objects'
		);

		$result = array();

		foreach ( $taxonomies as $taxonomy ) {
			$result[] = array(
				'id'           => $taxonomy->name,
				'label'        => $taxonomy->label,
				'singular'     => $taxonomy->labels->singular_name,
				'description'  => $taxonomy->description ?: '',
				'hierarchical' => (bool) $taxonomy->hierarchical,
				'postTypes'    => $taxonomy->object_type,
				'rest_base'    => $taxonomy->rest_base ?: $taxonomy->name,
			);
		}

		return $result;
	}

	/**
	 * Get all ACF field groups with their metadata.
	 * 
	 * @return array Array of field group data
	 */
	private function get_field_groups() {
		// Check if ACF is available
		if ( ! function_exists( 'acf_get_field_groups' ) ) {
			return array();
		}

		$field_groups = acf_get_field_groups();
		$result = array();

		foreach ( $field_groups as $group ) {
			// Get fields for this group
			$fields = acf_get_fields( $group['key'] );
			$field_list = array();
			
			if ( $fields ) {
				foreach ( $fields as $field ) {
					$field_list[] = array(
						'name'  => $field['name'],
						'label' => $field['label'],
						'type'  => $field['type'],
						'key'   => $field['key'],
					);
				}
			}

			// Parse location rules to make them readable
			$location_description = $this->parse_location_rules( $group['location'] );

			$result[] = array(
				'id'          => $group['key'],
				'title'       => $group['title'],
				'description' => isset( $group['description'] ) ? $group['description'] : '',
				'location'    => $group['location'],
				'locationDescription' => $location_description,
				'fields'      => $field_list,
				'active'      => (bool) $group['active'],
			);
		}

		return $result;
	}

	/**
	 * Get all individual ACF fields across all groups.
	 * 
	 * @return array Array of field data
	 */
	private function get_fields() {
		// Check if ACF is available
		if ( ! function_exists( 'acf_get_field_groups' ) ) {
			return array();
		}

		$field_groups = acf_get_field_groups();
		$result = array();

		foreach ( $field_groups as $group ) {
			$fields = acf_get_fields( $group['key'] );
			
			if ( $fields ) {
				foreach ( $fields as $field ) {
					// Get field settings (type-specific configurations)
					$settings = $this->get_field_settings( $field );

					$result[] = array(
						'id'          => $field['key'],
						'label'       => $field['label'],
						'name'        => $field['name'],
						'type'        => $field['type'],
						'parent'      => $group['key'],
						'parentTitle' => $group['title'],
						'instructions' => isset( $field['instructions'] ) ? $field['instructions'] : '',
						'required'    => (bool) ( isset( $field['required'] ) ? $field['required'] : false ),
						'settings'    => $settings,
					);
				}
			}
		}

		return $result;
	}

	/**
	 * Parse location rules into human-readable format.
	 * 
	 * @param array $location Location rules array
	 * @return string Human-readable location description
	 */
	private function parse_location_rules( $location ) {
		if ( empty( $location ) ) {
			return '';
		}

		$descriptions = array();

		foreach ( $location as $group ) {
			$group_descriptions = array();
			
			foreach ( $group as $rule ) {
				$param = $rule['param'];
				$operator = $rule['operator'];
				$value = $rule['value'];

				// Format the rule into readable text
				$rule_text = $this->format_location_rule( $param, $operator, $value );
				if ( $rule_text ) {
					$group_descriptions[] = $rule_text;
				}
			}

			if ( ! empty( $group_descriptions ) ) {
				$descriptions[] = implode( ' AND ', $group_descriptions );
			}
		}

		return ! empty( $descriptions ) ? implode( ' OR ', $descriptions ) : '';
	}

	/**
	 * Format a single location rule into readable text.
	 * 
	 * @param string $param Rule parameter
	 * @param string $operator Rule operator
	 * @param mixed $value Rule value
	 * @return string Formatted rule text
	 */
	private function format_location_rule( $param, $operator, $value ) {
		$operator_text = $operator === '==' ? 'is' : 'is not';

		switch ( $param ) {
			case 'post_type':
				$post_type_obj = get_post_type_object( $value );
				$label = $post_type_obj ? $post_type_obj->label : $value;
				return "Post Type $operator_text $label";
			
			case 'page_template':
				return "Page Template $operator_text $value";
			
			case 'taxonomy':
				$taxonomy_obj = get_taxonomy( $value );
				$label = $taxonomy_obj ? $taxonomy_obj->label : $value;
				return "Taxonomy $operator_text $label";
			
			case 'post':
				$post = get_post( $value );
				$label = $post ? $post->post_title : $value;
				return "Post $operator_text $label";
			
			default:
				return ucfirst( str_replace( '_', ' ', $param ) ) . " $operator_text $value";
		}
	}

	/**
	 * Get type-specific settings for a field.
	 * 
	 * @param array $field Field array
	 * @return array Field settings
	 */
	private function get_field_settings( $field ) {
		$settings = array();

		// Common settings
		if ( isset( $field['default_value'] ) && $field['default_value'] !== '' ) {
			$settings['default_value'] = $field['default_value'];
		}
		if ( isset( $field['placeholder'] ) && $field['placeholder'] !== '' ) {
			$settings['placeholder'] = $field['placeholder'];
		}

		// Type-specific settings
		switch ( $field['type'] ) {
			case 'text':
			case 'textarea':
				if ( isset( $field['maxlength'] ) && $field['maxlength'] ) {
					$settings['maxlength'] = $field['maxlength'];
				}
				break;

			case 'number':
			case 'range':
				if ( isset( $field['min'] ) && $field['min'] !== '' ) {
					$settings['min'] = $field['min'];
				}
				if ( isset( $field['max'] ) && $field['max'] !== '' ) {
					$settings['max'] = $field['max'];
				}
				if ( isset( $field['step'] ) && $field['step'] !== '' ) {
					$settings['step'] = $field['step'];
				}
				break;

			case 'select':
			case 'checkbox':
			case 'radio':
				if ( isset( $field['choices'] ) && is_array( $field['choices'] ) ) {
					$settings['choices'] = array_keys( $field['choices'] );
				}
				if ( isset( $field['multiple'] ) ) {
					$settings['multiple'] = (bool) $field['multiple'];
				}
				break;

			case 'true_false':
				if ( isset( $field['ui'] ) ) {
					$settings['ui'] = (bool) $field['ui'];
				}
				break;

			case 'relationship':
			case 'post_object':
				if ( isset( $field['post_type'] ) ) {
					$settings['post_type'] = $field['post_type'];
				}
				if ( isset( $field['multiple'] ) ) {
					$settings['multiple'] = (bool) $field['multiple'];
				}
				break;

			case 'taxonomy':
				if ( isset( $field['taxonomy'] ) ) {
					$settings['taxonomy'] = $field['taxonomy'];
				}
				if ( isset( $field['field_type'] ) ) {
					$settings['field_type'] = $field['field_type'];
				}
				break;

			case 'repeater':
			case 'group':
				if ( isset( $field['sub_fields'] ) && is_array( $field['sub_fields'] ) ) {
					$sub_fields = array();
					foreach ( $field['sub_fields'] as $sub_field ) {
						$sub_fields[] = array(
							'name'  => $sub_field['name'],
							'label' => $sub_field['label'],
							'type'  => $sub_field['type'],
						);
					}
					$settings['sub_fields'] = $sub_fields;
				}
				if ( isset( $field['min'] ) && $field['min'] ) {
					$settings['min'] = $field['min'];
				}
				if ( isset( $field['max'] ) && $field['max'] ) {
					$settings['max'] = $field['max'];
				}
				break;

			case 'image':
			case 'file':
				if ( isset( $field['return_format'] ) ) {
					$settings['return_format'] = $field['return_format'];
				}
				if ( isset( $field['library'] ) ) {
					$settings['library'] = $field['library'];
				}
				break;
		}

		return $settings;
	}
}

endif; // End class check

new ACF_Block_Builder_WordPress_Data();

