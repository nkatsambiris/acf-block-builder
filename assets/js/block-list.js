jQuery(document).ready(function($) {
    $('.acf-bb-toggle-switch.list-toggle input').on('change', function() {
        var $input = $(this);
        var $wrapper = $input.closest('.acf-bb-toggle-switch');
        var postId = $wrapper.data('post-id');
        var status = $input.is(':checked') ? '1' : '0';
        
        $input.prop('disabled', true);
        
        $.ajax({
            url: acfBlockBuilderList.ajax_url,
            type: 'POST',
            data: {
                action: 'acf_block_builder_toggle_active',
                nonce: acfBlockBuilderList.nonce,
                post_id: postId,
                status: status
            },
            success: function(response) {
                $input.prop('disabled', false);
                if (!response.success) {
                    // Revert if failed
                    $input.prop('checked', status !== '1');
                    alert('Error updating status');
                }
            },
            error: function() {
                $input.prop('disabled', false);
                // Revert
                $input.prop('checked', status !== '1');
                alert('System Error');
            }
        });
    });
});

