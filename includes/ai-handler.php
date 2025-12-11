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

		// Close session to prevent locking if applicable
		if ( session_status() === PHP_SESSION_ACTIVE ) {
			session_write_close();
		}

		$prompt = isset( $_POST['prompt'] ) ? sanitize_textarea_field( $_POST['prompt'] ) : '';
		$title  = isset( $_POST['title'] ) ? sanitize_text_field( $_POST['title'] ) : 'New Block';
		$image_id = isset( $_POST['image_id'] ) ? absint( $_POST['image_id'] ) : 0;
		$current_code = isset( $_POST['current_code'] ) ? wp_unslash( $_POST['current_code'] ) : '';
		$chat_history = isset( $_POST['chat_history'] ) ? json_decode( wp_unslash( $_POST['chat_history'] ), true ) : array();

		if ( empty( $prompt ) && empty( $image_id ) ) {
			wp_send_json_error( 'Prompt or Image is required.' );
		}

		$api_key = get_option( 'acf_block_builder_gemini_api_key' );
		if ( empty( $api_key ) ) {
			wp_send_json_error( 'Gemini API Key is missing. Please set it in the settings.' );
		}

		// Enable Streaming Headers
		header( 'Content-Type: text/event-stream' );
		header( 'Cache-Control: no-cache' );
		header( 'Connection: keep-alive' );
		header( 'X-Accel-Buffering: no' ); // Disable Nginx buffering

		// Call streaming API
		$this->stream_gemini_api( $api_key, $prompt, $title, $image_id, $current_code, $chat_history );
		
		die(); // Terminate WP execution
	}

	private function log( $message ) {
		if ( get_option( 'acf_block_builder_debug_enabled' ) ) {
			error_log( $message );
		}
	}

	private function stream_gemini_api( $api_key, $user_prompt, $title, $image_id = 0, $current_code = '', $chat_history = array() ) {
		$url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent?key=' . $api_key;

		$slug = sanitize_title( $title );
		
		// Load Reference Templates
		$ref_block_json = file_get_contents( ACF_BLOCK_BUILDER_PATH . 'templates/reference-block.json' );
		$ref_script_js  = file_get_contents( ACF_BLOCK_BUILDER_PATH . 'templates/reference-script.js' );

		$system_instruction = "You are an expert WordPress developer specializing in Advanced Custom Fields (ACF) Blocks in the Gutenberg editor.
		
		FLUID STREAMING MODE:
		1. You must communicate your thought process and code updates in a specific streaming format.
		2. First, PLAN and CHAT with the user in plain text.
		3. If you need to clarify something, ask a follow up question before generating code this will only be done once if required DO NOT ASK further questions and end up in a loop.
		4. Then, when you are ready to write code for a specific file, use the delimiters below.
		
		STREAMING FORMAT DELIMITERS:
		To start a file: @@@FILE:file_key@@@
		To end a file:   @@@END_FILE@@@
		
		Valid 'file_key' values:
		- plan (Use this for the initial step-by-step plan)
		- block_json
		- render_php
		- style_css
		- script_js
		- fields_php
		- assets_php
		- summary  (Use this for the final changelog summary)
		
		EXAMPLE INTERACTION:
		\"I will start by creating a plan...\"
		
		@@@FILE:plan@@@
		1. **block.json**: Update version...
		2. **render.php**: Add new loop...
		@@@END_FILE@@@
		
		\"Now I will update the block.json...\"
		
		@@@FILE:block_json@@@
		{
		  \"name\": \"acf/example\",
		  ...
		}
		@@@END_FILE@@@
		
		\"Finally, here is the summary...\"
		
		@@@FILE:summary@@@
		- Updated block.json
		- Fixed render.php
		@@@END_FILE@@@
		
		CRITICAL RULES:
		- Do NOT output the summary as plain text at the end. ALWAYS use @@@FILE:summary@@@.
		- Do NOT wrap the code in markdown code blocks (like ```php). Just output the raw code between the delimiters.
		- Do NOT output a single large JSON object. Output file by file mixed with chat.
		- Do NOT change the 'blockVersion' in the block.json file.
		- Always ensure any .php files start with <?php and end with ?> tags.
		- Verify complex fields (Link, Image) are arrays using !empty() && is_array().
		- Initialize variables.
		
		REFERENCES:
		1. block.json: $ref_block_json
		2. script.js: $ref_script_js
		
		CONTEXT:
		Block Title: $title
		Block Slug: $slug
		";

		// Build conversation contents array
		$contents = array();
		
		// First message includes system instruction with context
		$first_message_text = $system_instruction;
		if ( ! empty( $current_code ) ) {
			$first_message_text .= "\n\nCURRENT CODE CONTEXT (JSON):\n$current_code";
		}
		
		// Add chat history as alternating user/model messages
		if ( ! empty( $chat_history ) && is_array( $chat_history ) ) {
			$is_first_user_message = true;
			
			foreach ( $chat_history as $msg ) {
				if ( ! isset( $msg['type'] ) || ! isset( $msg['text'] ) ) {
					continue;
				}
				
				$role = ( $msg['type'] === 'user' ) ? 'user' : 'model';
				$text = sanitize_textarea_field( $msg['text'] );
				
				if ( empty( $text ) ) {
					continue;
				}
				
				// Prepend system instruction to the first user message
				if ( $role === 'user' && $is_first_user_message ) {
					$text = $first_message_text . "\n\nUSER REQUEST:\n" . $text;
					$is_first_user_message = false;
				}
				
				$contents[] = array(
					'role'  => $role,
					'parts' => array( array( 'text' => $text ) )
				);
			}
		}
		
		// Add the current user message
		$current_message_parts = array();
		
		if ( empty( $chat_history ) || empty( $contents ) ) {
			// No history - include system instruction in this message
			if ( ! empty( $current_code ) ) {
				$full_prompt = $first_message_text . "\n\nUSER REQUEST:\n$user_prompt\n\nRemember: Use @@@FILE:key@@@ delimiters. DO NOT WRAP CODE in markdown ``` blocks inside the delimiters.";
			} else {
				$full_prompt = $first_message_text . "\n\nDescription: $user_prompt\n\nRemember: Use @@@FILE:key@@@ delimiters. DO NOT WRAP CODE in markdown ``` blocks inside the delimiters.";
			}
		} else {
			// Has history - just send the user prompt
			$full_prompt = $user_prompt . "\n\nRemember: Use @@@FILE:key@@@ delimiters. DO NOT WRAP CODE in markdown ``` blocks inside the delimiters.";
		}
		
		$current_message_parts[] = array( 'text' => $full_prompt );

		// Handle Image
		if ( $image_id ) {
			$image_path = get_attached_file( $image_id );
			if ( $image_path && file_exists( $image_path ) ) {
				$mime_type = get_post_mime_type( $image_id );
				$image_data = base64_encode( file_get_contents( $image_path ) );
				
				$current_message_parts[] = array(
					'inline_data' => array(
						'mime_type' => $mime_type,
						'data'      => $image_data
					)
				);
			}
		}
		
		// Add current message to contents
		$contents[] = array(
			'role'  => 'user',
			'parts' => $current_message_parts
		);

		$body = array(
			'contents' => $contents,
			'generationConfig' => array(
				'temperature' => 0.2,
				'responseMimeType' => 'text/plain'
			)
		);

		// Use CURL for Streaming
		$ch = curl_init();
		curl_setopt( $ch, CURLOPT_URL, $url );
		curl_setopt( $ch, CURLOPT_POST, true );
		curl_setopt( $ch, CURLOPT_POSTFIELDS, json_encode( $body ) );
		curl_setopt( $ch, CURLOPT_HTTPHEADER, array( 'Content-Type: application/json' ) );
		curl_setopt( $ch, CURLOPT_RETURNTRANSFER, false ); // Important for manual stream handling
		curl_setopt( $ch, CURLOPT_WRITEFUNCTION, function( $curl, $data ) {
			// $data is the raw chunk from Gemini API (it might be a partial JSON structure)
			// Gemini sends: [{"candidates": [...]}]
            
            // We'll wrap it in an SSE event
            echo "data: " . base64_encode( $data ) . "\n\n";
            
            // Flush buffer to force send to client
            if ( ob_get_level() > 0 ) ob_flush();
            flush();
            
			return strlen( $data );
		} );

		curl_exec( $ch );
		curl_close( $ch );
        
        // End stream
        echo "data: [DONE]\n\n";
        flush();
	}
}

endif; // End class check

new ACF_Block_Builder_AI();
