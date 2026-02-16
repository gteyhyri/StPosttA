function getHoursWord(hours) {
    const lastDigit = hours % 10;
    const lastTwoDigits = hours % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
        return 'часов';
    }
    if (lastDigit === 1) {
        return 'час';
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
        return 'часа';
    }
    return 'часов';
}
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
        return '';
    }
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function safeSetText(element, text) {
    if (!element) return;
    element.textContent = text || '';
}
function safeSetHTML(element, html) {
    if (!element) return;
    element.innerHTML = html || '';
}
function createSafeElement(tagName, text, className) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (text) {
        element.textContent = text;
    }
    return element;
}
function safeSetAttribute(element, attr, value) {
    if (!element) return;
    const dangerousAttrs = ['onclick', 'onload', 'onerror', 'onmouseover'];
    if (dangerousAttrs.includes(attr.toLowerCase())) {
        console.warn(`Blocked dangerous attribute: ${attr}`);
        return;
    }
    if ((attr === 'href' || attr === 'src') && value) {
        const lowerValue = String(value).toLowerCase().trim();
        if (lowerValue.startsWith('javascript:') || lowerValue.startsWith('data:')) {
            console.warn(`Blocked dangerous ${attr}: ${value}`);
            return;
        }
    }
    element.setAttribute(attr, value);
}
function createSafeBloggerCard(blogger) {
    const wrapper = document.createElement('div');
    wrapper.className = 'blogger-card-wrapper';
    wrapper.dataset.topicGroupKey = blogger.topic_group_key || '';
    wrapper.dataset.topicSubKey = blogger.topic_sub_key || '';
    wrapper.dataset.channelId = blogger.channel_id || blogger.id || ''; 
    let subscribersNum = 0;
    if (blogger.subscribers_raw !== undefined) {
        subscribersNum = parseInt(blogger.subscribers_raw) || 0;
    } else {
        const subscribersRaw = blogger.subscribers || '0';
        if (typeof subscribersRaw === 'string') {
            const match = subscribersRaw.match(/[\d.]+/);
            if (match) {
                subscribersNum = parseFloat(match[0]);
                if (subscribersRaw.includes('K') || subscribersRaw.includes('К')) subscribersNum *= 1000;
                else if (subscribersRaw.includes('M') || subscribersRaw.includes('М')) subscribersNum *= 1000000;
            }
        } else {
            subscribersNum = parseInt(subscribersRaw) || 0;
        }
    }
    wrapper.dataset.subscribers = Math.floor(subscribersNum).toString();
    let priceNum = 0;
    if (blogger.price_raw !== undefined) {
        priceNum = parseInt(blogger.price_raw) || 0;
    } else {
        const priceRaw = blogger.price || '0';
        if (typeof priceRaw === 'string') {
            const match = priceRaw.match(/[\d]+/);
            if (match) {
                priceNum = parseInt(match[0]);
            }
        } else {
            priceNum = parseInt(priceRaw) || 0;
        }
    }
    wrapper.dataset.price = priceNum.toString();
    const card = document.createElement('div');
    card.className = 'blogger-card';
    const avatarWrapper = document.createElement('div');
    avatarWrapper.className = 'blogger-avatar-wrapper';
    const imageDiv = document.createElement('div');
    imageDiv.className = 'blogger-card-image';
    const avatar = document.createElement('img');
    avatar.className = 'blogger-photo';
    safeSetAttribute(avatar, 'src', blogger.photo_url || '/static/pic/default-avatar.png');
    safeSetAttribute(avatar, 'alt', escapeHtml(blogger.name));
    imageDiv.appendChild(avatar);
    avatarWrapper.appendChild(imageDiv);
    const content = document.createElement('div');
    content.className = 'blogger-card-content';
    const header = document.createElement('div');
    header.className = 'blogger-header';
    const name = document.createElement('div');
    name.className = 'blogger-channel-name';
    safeSetText(name, blogger.name);
    const headerRight = document.createElement('div');
    headerRight.className = 'blogger-header-right';
    const subscribers = document.createElement('span');
    subscribers.className = 'blogger-subscribers';
    safeSetText(subscribers, blogger.subscribers || '0'); 
    headerRight.appendChild(subscribers);
    header.appendChild(name);
    header.appendChild(headerRight);
    const topic = document.createElement('div');
    topic.className = 'blogger-topic';
    safeSetText(topic, blogger.topic_sub_title || ''); 
    content.appendChild(header);
    content.appendChild(topic);
    const price = document.createElement('div');
    price.className = 'blogger-price';
    safeSetText(price, blogger.price || '0 ₽'); 
    card.appendChild(avatarWrapper);
    card.appendChild(content);
    card.appendChild(price);
    wrapper.appendChild(card);
    wrapper.addEventListener('click', () => {
        openBloggerModal(blogger);
    });
    return wrapper;
}
function createSafeOfferCard(offer) {
    const wrapper = document.createElement('div');
    wrapper.className = 'blogger-card-wrapper';
    wrapper.dataset.offerId = offer.id || '';
    const card = document.createElement('div');
    card.className = 'blogger-card';
    let images = [];
    try {
        if (offer.images) {
            if (Array.isArray(offer.images)) {
                images = offer.images;
            } else if (typeof offer.images === 'string' && offer.images.trim().length) {
                images = JSON.parse(offer.images);
            }
        }
    } catch (e) {
        console.warn('Failed to parse offer images', e);
    }
    const firstImage = images.length ? images[0] : null;
    const imageDiv = document.createElement('div');
    imageDiv.className = 'blogger-card-image';
    if (firstImage) {
        const img = document.createElement('img');
        img.className = 'blogger-photo';
        safeSetAttribute(img, 'src', firstImage);
        safeSetAttribute(img, 'alt', 'Превью поста');
        imageDiv.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'blogger-photo offer-photo-placeholder';
        const inner = document.createElement('div');
        inner.className = 'blogger-photo-placeholder-inner';
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', 'image');
        inner.appendChild(icon);
        placeholder.appendChild(inner);
        imageDiv.appendChild(placeholder);
    }
    const contentDiv = document.createElement('div');
    contentDiv.className = 'blogger-card-content';
    const fullText = (offer.text || '').trim();
    let previewText = fullText;
    if (fullText) {
        const words = fullText.split(/\s+/);
        if (words.length > 4) {
            previewText = words.slice(0, 4).join(' ') + '...';
        }
    }
    const preview = document.createElement('p');
    preview.className = 'offer-card-preview';
    safeSetText(preview, previewText || 'Без описания');
    const metaRow = document.createElement('div');
    metaRow.className = 'offer-card-meta-row';
    if (offer.topic) {
        const topicSpan = document.createElement('span');
        topicSpan.className = 'offer-card-topic';
        safeSetText(topicSpan, offer.topic);
        metaRow.appendChild(topicSpan);
    }
    contentDiv.appendChild(preview);
    contentDiv.appendChild(metaRow);
    const priceDiv = document.createElement('div');
    priceDiv.className = 'blogger-price offer-price-container';
    const hourPrice = offer.hour_price || offer.hourPrice || 0;
    const durationHours = offer.duration_hours || offer.durationHours || 1;
    const priceText = document.createElement('span');
    priceText.className = 'offer-price-value';
    safeSetText(priceText, hourPrice ? `${hourPrice} ₽` : 'Без цены');
    const durationText = document.createElement('span');
    durationText.className = 'offer-duration-text';
    safeSetText(durationText, `за ${durationHours} ${getHoursWord(durationHours)}`);
    priceDiv.appendChild(priceText);
    priceDiv.appendChild(durationText);
    card.appendChild(imageDiv);
    card.appendChild(contentDiv);
    card.appendChild(priceDiv);
    wrapper.appendChild(card);
    wrapper.addEventListener('click', () => {
        const isOwner = offer.user_id && window.currentUserId && (offer.user_id === window.currentUserId);
        if (isOwner) {
            openOfferPreviewModal(offer, firstImage, fullText);
            return;
        }
        if (!currentUserIsBlogger) {
            openOfferNotBloggerModal();
            return;
        }
        openOfferPreviewModal(offer, firstImage, fullText);
    });
    return wrapper;
}
function createSafeReviewElement(review) {
    const reviewItem = document.createElement('div');
    reviewItem.className = 'review-item';
    const avatar = document.createElement('img');
    avatar.className = 'review-avatar';
    safeSetAttribute(avatar, 'src', review.reviewer?.avatar || '/static/pic/default-avatar.png');
    safeSetAttribute(avatar, 'alt', escapeHtml(review.reviewer?.name || 'User'));
    const content = document.createElement('div');
    content.className = 'review-content';
    const header = document.createElement('div');
    header.className = 'review-header';
    const name = document.createElement('div');
    name.className = 'review-name';
    safeSetText(name, review.reviewer?.name || 'Аноним');
    const rating = document.createElement('div');
    rating.className = 'review-rating';
    const ratingValue = document.createElement('span');
    ratingValue.className = 'review-rating-value';
    safeSetText(ratingValue, String(review.rating || 0));
    const star = document.createElement('span');
    star.className = 'review-rating-star';
    safeSetText(star, '⭐');
    rating.appendChild(ratingValue);
    rating.appendChild(star);
    header.appendChild(name);
    header.appendChild(rating);
    const text = document.createElement('div');
    text.className = 'review-text';
    safeSetText(text, review.text || '');
    content.appendChild(header);
    content.appendChild(text);
    reviewItem.appendChild(avatar);
    reviewItem.appendChild(content);
    return reviewItem;
}
window.xssProtection = {
    escapeHtml,
    safeSetText,
    safeSetHTML,
    createSafeElement,
    safeSetAttribute,
    createSafeBloggerCard,
    createSafeOfferCard,
    createSafeReviewElement
};
