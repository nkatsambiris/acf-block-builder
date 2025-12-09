<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}


// Updater
class ACF_Block_Builder_Plugin_Updater {

    private $current_version;
    private $api_url;
    private $plugin_basename;

    public function __construct($current_version, $api_url, $plugin_basename) {
        $this->current_version = $current_version;
        $this->api_url = $api_url;
        $this->plugin_basename = $plugin_basename;
    }

    public function check_for_update() {
        $debug_enabled = get_option('acf_block_builder_debug_enabled');

        if ($debug_enabled) {
            error_log('ACF Block Builder Updater: Making API call to: ' . $this->api_url);
        }

        $response = wp_remote_get($this->api_url);
        if (is_wp_error($response)) {
            if ($debug_enabled) {
                error_log('ACF Block Builder Updater: API call failed: ' . $response->get_error_message());
            }
            return false;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if ($debug_enabled) {
            error_log('ACF Block Builder Updater: API response: ' . $body);
        }

        if ($data && isset($data['version']) && version_compare($data['version'], $this->current_version, '>')) {
            if ($debug_enabled) {
                error_log('ACF Block Builder Updater: Version comparison - Remote: ' . $data['version'] . ' vs Local: ' . $this->current_version);
            }
            return $data;
        }

        if ($debug_enabled) {
            error_log('ACF Block Builder Updater: No update needed or invalid response data');
        }

        return false;
    }
}

function acf_block_builder_check_for_update($transient) {
    if (empty($transient->checked)) {
        return $transient;
    }

    // Get the plugin basename correctly
    $plugin_basename = plugin_basename(__FILE__);

    // Check if this plugin is in the checked list
    if (!isset($transient->checked[$plugin_basename])) {
        return $transient;
    }

    // Get current version from plugin header
    $plugin_data = get_plugin_data(__FILE__);
    $current_version = $plugin_data['Version'];

    // Debug logging if enabled
    $debug_enabled = get_option('acf_block_builder_debug_enabled');
    if ($debug_enabled) {
        error_log('ACF Block Builder Updater: Checking for updates. Current version: ' . $current_version);
        error_log('ACF Block Builder Updater: Plugin basename: ' . $plugin_basename);
    }

    $updater = new ACF_Block_Builder_Plugin_Updater($current_version, 'https://raw.githubusercontent.com/nkatsambiris/acf-block-builder/main/updates.json', $plugin_basename);
    $update_data = $updater->check_for_update();

    if ($update_data) {
        if ($debug_enabled) {
            error_log('ACF Block Builder Updater: Update available. New version: ' . $update_data['version']);
        }

        $transient->response[$plugin_basename] = (object) array(
            'slug' => dirname($plugin_basename),
            'plugin' => $plugin_basename,
            'new_version' => $update_data['version'],
            'url' => isset($update_data['details_url']) ? $update_data['details_url'] : '',
            'package' => $update_data['download_url'],
            'icons' => array(),
            'banners' => array(),
            'tested' => isset($update_data['tested']) ? $update_data['tested'] : '',
            'requires_php' => isset($update_data['requires_php']) ? $update_data['requires_php'] : '',
            'compatibility' => new stdClass(),
        );
    } else {
        if ($debug_enabled) {
            error_log('ACF Block Builder Updater: No update available or error checking for updates');
        }
    }

    return $transient;
}
add_filter('pre_set_site_transient_update_plugins', 'acf_block_builder_check_for_update');

// Displayed in the plugin info window
function acf_block_builder_plugin_info($false, $action, $args) {
    $plugin_basename = plugin_basename(__FILE__);
    $plugin_slug = dirname($plugin_basename);

    if (isset($args->slug) && $args->slug === $plugin_slug) {
        $response = wp_remote_get('https://raw.githubusercontent.com/nkatsambiris/acf-block-builder/main/plugin-info.json');
        if (!is_wp_error($response)) {
            $plugin_info = json_decode(wp_remote_retrieve_body($response));
            if ($plugin_info) {
                return (object) array(
                    'slug' => $plugin_slug,
                    'name' => $plugin_info->name,
                    'version' => $plugin_info->version,
                    'author' => $plugin_info->author,
                    'homepage' => isset($plugin_info->homepage) ? $plugin_info->homepage : '',
                    'requires' => $plugin_info->requires,
                    'tested' => $plugin_info->tested,
                    'requires_php' => isset($plugin_info->requires_php) ? $plugin_info->requires_php : '',
                    'last_updated' => $plugin_info->last_updated,
                    'sections' => array(
                        'description' => $plugin_info->sections->description,
                        'changelog' => $plugin_info->sections->changelog
                    ),
                    'download_link' => $plugin_info->download_link,
                    'banners' => array(
                        'low' => 'https://raw.githubusercontent.com/nkatsambiris/acf-block-builder/main/banner-772x250.jpg',
                        'high' => 'https://raw.githubusercontent.com/nkatsambiris/acf-block-builder/main/banner-1544x500.jpg'
                    ),
                    'icons' => array(),
                );
            }
        }
    }
    return $false;
}
add_filter('plugins_api', 'acf_block_builder_plugin_info', 10, 3);

// Used to handle the plugin folder name during updates
function acf_block_builder_upgrader_package_options($options) {
    $plugin_basename = plugin_basename(__FILE__);

    if (isset($options['hook_extra']['plugin']) && $options['hook_extra']['plugin'] === $plugin_basename) {
        $plugin_slug = dirname($plugin_basename);
        $options['destination'] = WP_PLUGIN_DIR . '/' . $plugin_slug;
        $options['clear_destination'] = true; // Overwrite the files
    }
    return $options;
}
add_filter('upgrader_package_options', 'acf_block_builder_upgrader_package_options');