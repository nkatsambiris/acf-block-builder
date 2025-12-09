(function($) {
    /**
     * Initialize the block's JavaScript.
     */
    var initializeBlock = function( $block ) {
        // Ensure jQuery is available
        if (typeof $ === 'undefined') return;

        // Find elements inside the block
        var $element = $block.find('.element-class');
        
        // Add event listeners or logic
        // ...
    };

    // Initialize each block on page load (front end)
    $(document).ready(function() {
        $('.block-slug').each(function() {
            initializeBlock( $(this) );
        });
    });

    // Initialize dynamic block preview (editor)
    if( window.acf ) {
        window.acf.addAction( 'render_block_preview/type=block-slug', initializeBlock );
    }

})(jQuery);
