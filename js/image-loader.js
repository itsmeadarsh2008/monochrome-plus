// js/image-loader.js
// Optimized image loading with skeleton shimmer effects

const OBSERVER_OPTIONS = {
    rootMargin: '200px 0px',
    threshold: 0.01,
};

let imageObserver = null;

function revealImage(img) {
    // Remove shimmer from parent wrapper
    const wrapper = img.closest('.card-image-wrapper');
    if (wrapper) {
        wrapper.classList.remove('img-loading');
    }
    // Remove shimmer from standalone images (track covers, detail headers)
    img.classList.remove('img-loading');
}

function onImageLoad(event) {
    const img = event.target;
    img.removeEventListener('load', onImageLoad);
    img.removeEventListener('error', onImageError);
    revealImage(img);
}

function onImageError(event) {
    const img = event.target;
    img.removeEventListener('load', onImageLoad);
    img.removeEventListener('error', onImageError);
    // Still reveal on error to show fallback/broken state
    revealImage(img);
}

function observeImage(img) {
    if (img.complete && img.naturalWidth > 0) {
        revealImage(img);
        return;
    }
    img.addEventListener('load', onImageLoad);
    img.addEventListener('error', onImageError);
}

function processNewImages(root = document) {
    const images = root.querySelectorAll(
        '.card-image-wrapper.img-loading img, img.img-loading, .detail-header-image.img-loading'
    );
    images.forEach(observeImage);
}

// Use MutationObserver to catch dynamically inserted images
let mutationObserver = null;

export function initImageLoader() {
    // Process any existing images
    processNewImages();

    // Watch for new images added to the DOM
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                hasNewNodes = true;
                break;
            }
        }
        if (hasNewNodes) {
            processNewImages();
        }
    });

    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });
}
