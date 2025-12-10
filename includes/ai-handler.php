<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'ACF_Block_Builder_AI' ) ) :

class ACF_Block_Builder_AI {

	public function __construct() {
		add_action( 'wp_ajax_acf_block_builder_generate', array( $this, 'handle_ajax_generate' ) );
	}

	public function handle_ajax_generate() {
		check_ajax_referer( 'acf_block_builder_ai', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		$prompt = isset( $_POST['prompt'] ) ? sanitize_textarea_field( $_POST['prompt'] ) : '';
		$title  = isset( $_POST['title'] ) ? sanitize_text_field( $_POST['title'] ) : 'New Block';
		$image_id = isset( $_POST['image_id'] ) ? absint( $_POST['image_id'] ) : 0;
		$current_code = isset( $_POST['current_code'] ) ? wp_unslash( $_POST['current_code'] ) : '';

		if ( empty( $prompt ) && empty( $image_id ) ) {
			wp_send_json_error( 'Prompt or Image is required.' );
		}

		$api_key = get_option( 'acf_block_builder_gemini_api_key' );
		if ( empty( $api_key ) ) {
			wp_send_json_error( 'Gemini API Key is missing. Please set it in the settings.' );
		}

		$generated_code = $this->call_gemini_api( $api_key, $prompt, $title, $image_id, $current_code );

		if ( is_wp_error( $generated_code ) ) {
			wp_send_json_error( $generated_code->get_error_message() );
		}

		wp_send_json_success( $generated_code );
	}

	private function log( $message ) {
		if ( get_option( 'acf_block_builder_debug_enabled' ) ) {
			error_log( $message );
		}
	}

	private function call_gemini_api( $api_key, $user_prompt, $title, $image_id = 0, $current_code = '' ) {
		$url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=' . $api_key;

		$slug = sanitize_title( $title );
		
		// Load Reference Templates
		$ref_block_json = file_get_contents( ACF_BLOCK_BUILDER_PATH . 'templates/reference-block.json' );
		$ref_script_js  = file_get_contents( ACF_BLOCK_BUILDER_PATH . 'templates/reference-script.js' );

		$system_instruction = "You are an expert WordPress developer specializing in Advanced Custom Fields (ACF) Blocks. 
		Your task is to generate or update the code for an ACF Block based on the user's description (and optional reference image).

		CRITICAL ERROR PREVENTION - YOU MUST FOLLOW THIS:
		- You MUST verify that complex fields (Link, Image, File, Post Object, Relationship, Taxonomy) are arrays before accessing their keys.
		- The most common error is: 'Uncaught TypeError: Cannot access offset of type string on string'. This happens when you try to access keys like `\$link['url']` but `\$link` is an empty string.
		- CORRECT PATTERN: `if ( ! empty( \$link ) && is_array( \$link ) ) { ... \$link['url'] ... }`
		- INCORRECT PATTERN: `if ( \$link ) { ... }` (This is NOT sufficient for array fields).
		- ALWAYS initialize variables to avoid undefined variable warnings.
		
		IMPORTANT: FOLLOW THESE REFERENCE STRUCTURES EXACTLY.
		
		1. 'block.json' Structure:
		$ref_block_json
		
		2. 'script.js' Structure (Use jQuery wrapper and acf.addAction):
		$ref_script_js
		
		3. Inline Editing (ACF Blocks v3):
		   - Use 'acf_inline_text_editing_attrs( 'field_name' )' for text elements.
		   - Use 'acf_inline_toolbar_editing_attrs( array( 'field_name' ) )' for images/links.
		
		You must return ONLY a valid JSON object with the following keys:
		- 'summary': A brief, human-readable summary of the changes made (e.g., \"Added a new text field for the title and updated the render template.\").
		- 'block_json': The content of block.json. Adapt the reference to the user's block. Ensure 'blockVersion': 3 and 'autoInlineEditing': true. IMPORTANT: Add 'script' property pointing to 'file:./script.js'.
		- 'render_php': The PHP code for render.php. Use 'get_field()' and inline editing attributes. REMEMBER THE CRITICAL ERROR PREVENTION: check `is_array()` for all complex fields.
		- 'style_css': The CSS code for style.css.
		- 'script_js': The JavaScript code for script.js. Follow the reference structure. Replace 'block-slug' with '$slug'.
		- 'fields_php': The PHP code to register the ACF fields using 'acf_add_local_field_group()'. Ensure location is 'block' => 'acf/$slug' MUST start with '<?php' and end with '?>'.
		- 'assets_php': A PHP file that hooks into 'enqueue_block_assets' to load 3rd-party libraries (Swiper, Slick, AOS, etc.) if needed. Use 'wp_register_script'/'wp_enqueue_script'. Conditionally check 'has_block( \"acf/$slug\" )'. If no 3rd party assets are needed, return empty string. MUST start with '<?php' and end with '?>'.
		
		Do not include markdown formatting like ```json. Just the raw JSON string.
		";

		if ( ! empty( $current_code ) ) {
			$full_prompt = "Block Title: $title\nBlock Slug: $slug\n\nCURRENT CODE CONTEXT (JSON):\n$current_code\n\nUSER MODIFICATION REQUEST:\n$user_prompt\n\nPlease update the code based on the user's request. Return the FULL updated code for all files (block_json, render_php, style_css, script_js, fields_php, assets_php), even if some are unchanged. ALSO provide a 'summary' key explaining what you changed.";
		} else {
			$full_prompt = "Block Title: $title\nBlock Slug: $slug\nDescription: $user_prompt";
		}

		$contents_parts = array();
		
		// Add System Instruction as the first part if possible, or just prepend to user prompt?
		// Gemini API "system_instruction" is usually a separate top-level field, but here we are using "generateContent".
		// We can just add the system instruction as text.
		$contents_parts[] = array( 'text' => $system_instruction . "\n\nUser Request:\n" . $full_prompt );

		// Handle Image
		if ( $image_id ) {
			$image_path = get_attached_file( $image_id );
			if ( $image_path && file_exists( $image_path ) ) {
				$mime_type = get_post_mime_type( $image_id );
				$image_data = base64_encode( file_get_contents( $image_path ) );
				
				$contents_parts[] = array(
					'inline_data' => array(
						'mime_type' => $mime_type,
						'data'      => $image_data
					)
				);
			}
		}

		$body = array(
			'contents' => array(
				array(
					'parts' => $contents_parts
				)
			),
			'generationConfig' => array(
				'temperature' => 0.2,
				'responseMimeType' => 'application/json'
			)
		);

		$this->log( 'ACF Block Builder AI: Sending Request. Prompt Length: ' . strlen( $full_prompt ) );

		$response = wp_remote_post( $url, array(
			'body'    => json_encode( $body ),
			'headers' => array( 'Content-Type' => 'application/json' ),
			'timeout' => 240, // Increased timeout to 120 seconds
		));

		if ( is_wp_error( $response ) ) {
			$this->log( 'ACF Block Builder AI Error: ' . $response->get_error_message() );
			return $response;
		}

		$response_code = wp_remote_retrieve_response_code( $response );
		if ( $response_code !== 200 ) {
			$body = wp_remote_retrieve_body( $response );
			$this->log( 'ACF Block Builder AI API Error (' . $response_code . '): ' . $body );
			return new WP_Error( 'api_error', 'Gemini API Error: ' . $response_code . ' - ' . $body );
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		// Check for safety ratings or finish reason
		if ( isset( $data['candidates'][0]['finishReason'] ) && $data['candidates'][0]['finishReason'] !== 'STOP' ) {
			$reason = $data['candidates'][0]['finishReason'];
			$this->log( 'ACF Block Builder AI Finish Reason: ' . $reason );
			return new WP_Error( 'api_error', 'AI Generation stopped. Reason: ' . $reason );
		}

		if ( empty( $data['candidates'][0]['content']['parts'][0]['text'] ) ) {
			$this->log( 'ACF Block Builder AI Empty Response: ' . print_r( $data, true ) );
			return new WP_Error( 'api_error', 'Invalid response from API. Check server logs for details.' );
		}

		$text = $data['candidates'][0]['content']['parts'][0]['text'];

		// Debug: Log the raw response
		$this->log( 'ACF Block Builder AI Raw Response: ' . $text );
		
		// Attempt to parse the JSON
		$json_data = json_decode( $text, true );
		if ( json_last_error() !== JSON_ERROR_NONE ) {
			// Include a snippet of the response in the error for easier debugging
			$snippet = substr( $text, 0, 500 );
			return new WP_Error( 'json_error', 'Failed to parse AI response as JSON: ' . json_last_error_msg() . '. Raw Response Snippet: ' . $snippet );
		}

		// Ensure PHP files have opening tags
		if ( ! empty( $json_data['render_php'] ) && strpos( trim( $json_data['render_php'] ), '<?php' ) !== 0 ) {
			$json_data['render_php'] = "<?php\n" . $json_data['render_php'];
		}
		if ( ! empty( $json_data['fields_php'] ) && strpos( trim( $json_data['fields_php'] ), '<?php' ) !== 0 ) {
			$json_data['fields_php'] = "<?php\n" . $json_data['fields_php'];
		}
		if ( ! empty( $json_data['assets_php'] ) && strpos( trim( $json_data['assets_php'] ), '<?php' ) !== 0 ) {
			$json_data['assets_php'] = "<?php\n" . $json_data['assets_php'];
		}

		return $json_data;
	}
}

endif; // End class check

new ACF_Block_Builder_AI();
