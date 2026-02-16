let selectedScheduleDays = [];
let scheduleTimesByDay = {}; // { 'Пн': { from: '09:00', to: '18:00' }, ... }
let currentTimeEditDayShort = null;
let currentTimeEditButton = null;
function getScheduleWeekdayLabels(shortCode) {
    const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('app_language')) || 'ru';
    const all = (typeof window !== 'undefined' && window.WEEKDAY_LABELS) || null;
    if (all) {
        const dict = all[lang] || all['ru'] || {};
        if (dict[shortCode]) {
            return dict[shortCode];
        }
    }
    const fallback = {
        'Пн': { short: 'Пн', full: 'Понедельник' },
        'Вт': { short: 'Вт', full: 'Вторник' },
        'Ср': { short: 'Ср', full: 'Среда' },
        'Чт': { short: 'Чт', full: 'Четверг' },
        'Пт': { short: 'Пт', full: 'Пятница' },
        'Сб': { short: 'Сб', full: 'Суббота' },
        'Вс': { short: 'Вс', full: 'Воскресенье' }
    };
    return fallback[shortCode] || { short: shortCode, full: shortCode };
}
function attachTimeInputMask(input) {
    if (!input || input._timeMaskAttached) return;
    input._timeMaskAttached = true;
    input.addEventListener('input', () => {
        let digits = (input.value || '').replace(/\D/g, '').slice(0, 4); // только 4 цифры
        if (digits.length <= 2) {
            input.value = digits;
        } else {
            input.value = digits.slice(0, 2) + ':' + digits.slice(2);
        }
    });
}
function openScheduleModal() {
    console.log('Opening schedule modal');
    if (typeof closeBloggerCardModal === 'function') {
        closeBloggerCardModal();
    }
    const overlay = document.getElementById('schedule-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) {
        console.error('Schedule modal overlay not found');
        return;
    }
    generateWeekCalendar();
    if (typeof authenticatedFetch === 'function') {
        loadScheduleFromServer();
    }
    overlay.classList.add('active', 'schedule-active');
    blurOverlay.classList.add('active');
    if (document && document.body) {
        if (typeof window !== 'undefined') {
            if (window._schedulePrevBodyOverflow === undefined) {
                window._schedulePrevBodyOverflow = document.body.style.overflow || '';
            }
            if (document.documentElement && window._schedulePrevHtmlOverflow === undefined) {
                window._schedulePrevHtmlOverflow = document.documentElement.style.overflow || '';
            }
        }
        document.body.style.overflow = 'hidden';
        if (document.documentElement) {
            document.documentElement.style.overflow = 'hidden';
        }
    }
    pauseModalAnimations();
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }
    setTimeout(() => {
        if (window.lucide) {
            lucide.createIcons();
        }
    }, 100);
}
function closeScheduleModal() {
    console.log('Closing schedule modal');
    const overlay = document.getElementById('schedule-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (overlay) {
        overlay.classList.remove('active', 'schedule-active');
    }
    blurOverlay.classList.remove('active');
    if (document && document.body) {
        if (typeof window !== 'undefined') {
            document.body.style.overflow =
                window._schedulePrevBodyOverflow !== undefined
                    ? window._schedulePrevBodyOverflow
                    : '';
            if (document.documentElement) {
                document.documentElement.style.overflow =
                    window._schedulePrevHtmlOverflow !== undefined
                        ? window._schedulePrevHtmlOverflow
                        : '';
            }
            window._schedulePrevBodyOverflow = undefined;
            window._schedulePrevHtmlOverflow = undefined;
        } else {
            document.body.style.overflow = '';
        }
        document.body.classList.remove('keyboard-open');
    }
    resumeModalAnimations();
}
function addNewChannel() {
    console.log('Add new channel clicked');
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }
    if (typeof closeBloggerCardModal === 'function') {
        console.log('Closing blogger card modal...');
        closeBloggerCardModal();
    }
    if (typeof closeChannelSettingsModal === 'function') {
        console.log('Closing channel settings modal...');
        closeChannelSettingsModal();
    }
    setTimeout(() => {
        console.log('Opening blogger application modal...');
        if (typeof openBloggerApplicationModal === 'function') {
            openBloggerApplicationModal();
        }
    }, 100);
}
function openChannelVerificationModal(channelId, channelLink) {
    console.log('Opening channel verification modal');
    const modal = document.getElementById('channel-verification-modal');
    const overlay = document.getElementById('channel-verification-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!modal || !overlay) {
        console.error('Channel verification modal not found');
        return;
    }
    modal.dataset.channelId = channelId;
    overlay.classList.add('active');
    blurOverlay.classList.add('active');
    setTimeout(() => {
        if (window.lucide) {
            lucide.createIcons();
        }
    }, 100);
}
function closeChannelVerificationModal() {
    const overlay = document.getElementById('channel-verification-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
    blurOverlay.classList.remove('active');
}
async function verifyChannel() {
    const modal = document.getElementById('channel-verification-modal');
    const channelId = modal ? modal.dataset.channelId : null;
    if (!channelId) {
        console.error('Channel ID not found');
        return;
    }
    try {
        const response = await authenticatedFetch(`/api/blogger/channels/${channelId}/verify`, {
            method: 'POST'
        });
        const data = await response.json();
        if (response.ok && data.verified) {
            if (typeof showNotification === 'function') {
                showNotification(data.message, 'success', 'Успешно');
            }
            closeChannelVerificationModal();
            loadBloggerChannels();
        } else {
            if (typeof showNotification === 'function') {
                showNotification(data.message || 'Бот не добавлен в канал', 'error', 'Ошибка');
            }
        }
    } catch (error) {
        console.error('Error verifying channel:', error);
        if (typeof showNotification === 'function') {
            showNotification('Ошибка при проверке канала', 'error', 'Ошибка');
        }
    }
}
async function loadBloggerChannels() {
    console.log('🔄 loadBloggerChannels called!');
    try {
        const response = await authenticatedFetch('/api/blogger/channels/list');
        const data = await response.json();
        console.log('📡 API response:', data);
        if (response.ok) {
            console.log('Rendering channels:', data.channels?.length || 0);
            window.cachedChannelsData = data.channels || [];
            renderBloggerChannels(data.channels || []);
        }
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}
function renderBloggerChannels(channels) {
    console.log('📋 renderBloggerChannels called with', channels.length, 'channels');
    const container = document.getElementById('blogger-channels-list');
    if (!container) {
        console.error('❌ Container blogger-channels-list not found!');
        return;
    }
    console.log('✅ Container found:', container);
    console.log('Container parent:', container.parentElement);
    console.log('Container visible:', container.offsetParent !== null);
    if (channels.length === 0) {
        console.log('No channels to render');
        container.innerHTML = '';
        return;
    }
    container.innerHTML = '';
    console.log('Container cleared');
    channels.forEach((channel, index) => {
        console.log(`Creating card ${index + 1}:`, channel.channel_name);
        const card = document.createElement('div');
        card.className = 'blogger-channel-card';
        card.onclick = () => openChannelDetailModal(channel.id);
        const avatar = document.createElement('div');
        avatar.className = 'blogger-channel-avatar';
        if (channel.channel_photo_url) {
            const img = document.createElement('img');
            img.src = channel.channel_photo_url;
            img.alt = channel.channel_name || 'Канал';
            img.className = 'channel-photo';
            img.loading = 'lazy'; // Lazy loading for better mobile performance
            img.onerror = function() {
                console.warn('Failed to load channel photo:', channel.channel_photo_url);
                img.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'channel-photo-placeholder';
                placeholder.innerHTML = '<i data-lucide="hash"></i>';
                avatar.appendChild(placeholder);
                if (window.lucide) lucide.createIcons();
            };
            avatar.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'channel-photo-placeholder';
            placeholder.innerHTML = '<i data-lucide="hash"></i>';
            avatar.appendChild(placeholder);
        }
        const info = document.createElement('div');
        info.className = 'blogger-channel-info';
        const name = document.createElement('div');
        name.className = 'blogger-channel-name';
        name.textContent = channel.channel_name || 'Канал';
        const subscribers = document.createElement('div');
        subscribers.className = 'blogger-channel-subscribers';
        const subsCount = channel.subscribers_count || '0';
        subscribers.textContent = `${subsCount} подписчиков`;
        info.appendChild(name);
        info.appendChild(subscribers);
        const price = document.createElement('div');
        price.className = 'blogger-channel-price';
        price.textContent = channel.price || '0₽';
        card.appendChild(avatar);
        card.appendChild(info);
        card.appendChild(price);
        container.appendChild(card);
        console.log(`Card ${index + 1} added to container`);
    });
    console.log('✅ All cards rendered. Container HTML:', container.innerHTML.substring(0, 200));
    console.log('Container children count:', container.children.length);
    console.log('Container display:', window.getComputedStyle(container).display);
    console.log('Container visibility:', window.getComputedStyle(container).visibility);
    console.log('Container opacity:', window.getComputedStyle(container).opacity);
    console.log('Container height:', container.offsetHeight, 'px');
    console.log('Container scrollHeight:', container.scrollHeight, 'px');
    console.log('Container position:', container.getBoundingClientRect());
    const rect = container.getBoundingClientRect();
    const inViewport = (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
    console.log('Container in viewport:', inViewport);
    if (window.lucide) {
        lucide.createIcons();
    }
}
function openChannelDetailModal(channelId) {
    console.log('Opening channel detail modal for channel:', channelId);
    closeBloggerCardModal();
    window.currentChannelId = channelId;
    setTimeout(async () => {
        await openChannelSettingsModal(channelId);
    }, 300);
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }
}
async function openChannelSettingsModal(channelId) {
    const modalOverlay = document.getElementById('channel-settings-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    if (!modalOverlay) return;
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.add('active');
    }
    try {
        let channel = null;
        if (window.cachedChannelsData && window.cachedChannelsData.length > 0) {
            channel = window.cachedChannelsData.find(c => c.id === channelId);
            if (channel) {
                console.log('✅ Using cached channel data for instant display');
                updateChannelModalUI(channel);
            }
        }
        const response = await authenticatedFetch(`/api/blogger/channels/list`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error('Failed to load channel data');
        }
        channel = data.channels.find(c => c.id === channelId);
        if (!channel) {
            throw new Error('Channel not found');
        }
        window.cachedChannelsData = data.channels;
        updateChannelModalUI(channel);
    } catch (error) {
        console.error('Error opening channel settings:', error);
        if (typeof showNotification === 'function') {
            showNotification('Не удалось загрузить данные канала', 'error', 'Ошибка');
        }
    }
}
function updateChannelModalUI(channel) {
    window.currentChannelData = channel;
    const imgElement = document.getElementById('channel-settings-img');
    const photoPlaceholder = document.getElementById('channel-photo-placeholder');
    const nameElement = document.getElementById('channel-settings-name');
    const subscribersElement = document.getElementById('channel-settings-subscribers');
    const priceElement = document.getElementById('channel-settings-price');
    const statusToggle = document.getElementById('channel-status-toggle');
    if (channel.channel_photo_url) {
        imgElement.src = channel.channel_photo_url;
        imgElement.classList.add('active');
        if (photoPlaceholder) photoPlaceholder.classList.add('hidden');
        imgElement.onerror = function() {
            console.warn('Failed to load channel photo:', channel.channel_photo_url);
            imgElement.classList.remove('active');
            if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
        };
    } else {
        imgElement.classList.remove('active');
        if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
    }
    if (channel.channel_link) {
        nameElement.innerHTML = `<a href="${channel.channel_link}" target="_blank" class="channel-link">${channel.channel_name || '@channel'}</a>`;
    } else {
        nameElement.textContent = channel.channel_name || '@channel';
    }
    const subsCount = channel.subscribers_count || '0';
    subscribersElement.textContent = subsCount;
    const priceValue = channel.price || '0';
    const cleanPrice = priceValue.replace(/₽/g, '').trim();
    window.currentChannelPrice = cleanPrice;
    const pricePermanentValue = channel.price_permanent || '';
    const cleanPricePermanent = pricePermanentValue.replace(/₽/g, '').trim();
    window.currentChannelPricePermanent = cleanPricePermanent;
    if (cleanPrice === '0' || cleanPrice === '') {
        priceElement.innerHTML = '<span class="price-value">Укажите цену</span> <span class="price-label">₽ / 12 часов</span>';
    } else {
        priceElement.innerHTML = `<span class="price-value">${cleanPrice}</span> <span class="price-label">₽ / 12 часов</span>`;
    }
    const pricePermanentElement = document.getElementById('channel-settings-price-permanent');
    if (pricePermanentElement) {
        if (cleanPricePermanent === '' || cleanPricePermanent === '0') {
            pricePermanentElement.innerHTML = '<span class="price-value-permanent">Укажите цену</span> <span class="price-label">/ без удаления</span>';
            pricePermanentElement.classList.add('placeholder');
        } else {
            pricePermanentElement.innerHTML = `<span class="price-value-permanent">${cleanPricePermanent} ₽</span> <span class="price-label">/ без удаления</span>`;
            pricePermanentElement.classList.remove('placeholder');
        }
        pricePermanentElement.classList.add('editable');
    }
    if (channel.is_active) {
        statusToggle.classList.add('active');
    } else {
        statusToggle.classList.remove('active');
    }
    setTimeout(() => {
        if (window.lucide) {
            lucide.createIcons();
        }
    }, 50);
}
function closeChannelSettingsModal() {
    const modalOverlay = document.getElementById('channel-settings-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
        }
        setTimeout(() => {
            if (typeof loadBloggerChannels === 'function') {
                loadBloggerChannels();
            }
        }, 300);
    }
}
function editChannelPriceInline(priceType = '12h') {
    const priceDisplay = document.getElementById('channel-settings-price');
    const pricePermanentDisplay = document.getElementById('channel-settings-price-permanent');
    const priceEdit = document.getElementById('channel-settings-price-edit');
    const priceInput = document.getElementById('channel-price-inline-input');
    const labelText = document.getElementById('channel-price-edit-label-text');
    if (priceDisplay && priceEdit && priceInput) {
        window.editingChannelPriceType = priceType;
        priceDisplay.style.display = 'none';
        if (pricePermanentDisplay) {
            pricePermanentDisplay.style.display = 'none';
        }
        priceEdit.style.display = 'flex';
        if (priceType === 'permanent') {
            priceInput.value = window.currentChannelPricePermanent || '';
            if (labelText) labelText.textContent = '/ без удаления';
        } else {
            priceInput.value = window.currentChannelPrice || '';
            if (labelText) labelText.textContent = '/ 12 часов';
        }
        priceInput.focus();
        priceInput.select();
    }
}
async function saveChannelPriceInline() {
    const priceInput = document.getElementById('channel-price-inline-input');
    const newPrice = priceInput.value.trim();
    const priceType = window.editingChannelPriceType || '12h';
    if (!newPrice || isNaN(newPrice) || parseFloat(newPrice) < 0) {
        if (typeof showNotification === 'function') {
            showNotification('Пожалуйста, укажите корректную цену', 'error', 'Ошибка');
        }
        return;
    }
    try {
        const updateData = {};
        if (priceType === 'permanent') {
            updateData.price = window.currentChannelPrice || '0';
            updateData.price_permanent = newPrice;
        } else {
            updateData.price = newPrice;
            updateData.price_permanent = window.currentChannelPricePermanent || '';
        }
        const response = await authenticatedFetch(`/api/blogger/channels/${window.currentChannelId}/update`, {
            method: 'POST',
            body: JSON.stringify(updateData)
        });
        if (!response.ok) {
            throw new Error('Failed to update price');
        }
        if (priceType === 'permanent') {
            window.currentChannelPricePermanent = newPrice;
            const pricePermanentDisplay = document.getElementById('channel-settings-price-permanent');
            if (pricePermanentDisplay) {
                pricePermanentDisplay.innerHTML = `<span class="price-value-permanent">${newPrice} ₽</span> <span class="price-label">/ без удаления</span>`;
                pricePermanentDisplay.classList.remove('placeholder');
            }
        } else {
            window.currentChannelPrice = newPrice;
            const priceDisplay = document.getElementById('channel-settings-price');
            priceDisplay.innerHTML = `<span class="price-value">${newPrice}</span> <span class="price-label">₽ / 12 часов</span>`;
        }
        cancelChannelPriceInline();
        if (typeof showNotification === 'function') {
            showNotification('Цена обновлена', 'success', 'Успешно');
        }
    } catch (error) {
        console.error('Error updating price:', error);
        if (typeof showNotification === 'function') {
            showNotification('Не удалось обновить цену', 'error', 'Ошибка');
        }
    }
}
function cancelChannelPriceInline() {
    const priceDisplay = document.getElementById('channel-settings-price');
    const pricePermanentDisplay = document.getElementById('channel-settings-price-permanent');
    const priceEdit = document.getElementById('channel-settings-price-edit');
    if (priceDisplay && priceEdit) {
        priceEdit.style.display = 'none';
        priceDisplay.style.display = 'flex';
        if (pricePermanentDisplay) {
            pricePermanentDisplay.style.display = 'flex';
        }
    }
}
async function toggleChannelStatus(toggle) {
    if (!toggle) return;
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }
    toggle.classList.toggle('active');
    const isActive = toggle.classList.contains('active');
    try {
        const response = await authenticatedFetch(`/api/blogger/channels/${window.currentChannelId}/update`, {
            method: 'POST',
            body: JSON.stringify({
                is_active: isActive
            })
        });
        if (!response.ok) {
            throw new Error('Failed to update status');
        }
        if (typeof showNotification === 'function') {
            if (isActive) {
                showNotification('Канал активен и виден в поиске', 'success', 'Канал активен');
            } else {
                showNotification('Канал скрыт из поиска', 'info', 'Канал скрыт');
            }
        }
    } catch (error) {
        console.error('Error updating status:', error);
        toggle.classList.toggle('active');
        if (typeof showNotification === 'function') {
            showNotification('Не удалось обновить статус', 'error', 'Ошибка');
        }
    }
}
async function deleteChannel() {
    if (!window.currentChannelId) return;
    const confirmed = confirm('Вы уверены, что хотите удалить этот канал? Это действие нельзя отменить.');
    if (!confirmed) return;
    const channelIdToDelete = window.currentChannelId;
    try {
        const response = await authenticatedFetch(`/api/blogger/channels/${channelIdToDelete}/delete`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error('Failed to delete channel');
        }
        if (typeof showNotification === 'function') {
            showNotification('Канал удален', 'success', 'Успешно');
        }
        closeChannelSettingsModal();
        setTimeout(async () => {
            console.log('🔄 Reloading channels after deletion...');
            if (typeof loadProfileChannels === 'function') {
                await loadProfileChannels();
                console.log('✅ Profile channels reloaded');
            } else if (typeof window.loadProfileChannels === 'function') {
                await window.loadProfileChannels();
                console.log('✅ Profile channels reloaded (via window)');
            }
            if (typeof loadBloggerChannels === 'function') {
                await loadBloggerChannels();
                console.log('✅ Blogger channels reloaded');
            } else if (typeof window.loadBloggerChannels === 'function') {
                await window.loadBloggerChannels();
                console.log('✅ Blogger channels reloaded (via window)');
            }
        }, 100);
    } catch (error) {
        console.error('Error deleting channel:', error);
        if (typeof showNotification === 'function') {
            showNotification('Не удалось удалить канал', 'error', 'Ошибка');
        }
    }
}
function openChannelScheduleModal() {
    closeChannelSettingsModal();
    setTimeout(() => {
        if (typeof openScheduleModal === 'function') {
            openScheduleModal();
        }
    }, 300);
}
window.openChannelSettingsModal = openChannelSettingsModal;
window.closeChannelSettingsModal = closeChannelSettingsModal;
window.editChannelPriceInline = editChannelPriceInline;
window.saveChannelPriceInline = saveChannelPriceInline;
window.cancelChannelPriceInline = cancelChannelPriceInline;
window.toggleChannelStatus = toggleChannelStatus;
window.deleteChannel = deleteChannel;
window.openChannelScheduleModal = openChannelScheduleModal;
async function deleteFirstChannel() {
    const confirmed = confirm('Вы уверены, что хотите удалить этот канал? Это действие нельзя отменить.');
    if (!confirmed) return;
    try {
        const response = await authenticatedFetch('/api/blogger/status');
        if (!response.ok) {
            throw new Error('Failed to get blogger status');
        }
        const statusData = await response.json();
        if (!statusData.has_application) {
            throw new Error('No application found');
        }
        const deleteResponse = await authenticatedFetch('/api/blogger/delete-first-channel', {
            method: 'DELETE'
        });
        if (!deleteResponse.ok) {
            const errorData = await deleteResponse.json();
            throw new Error(errorData.error || 'Failed to delete channel');
        }
        if (typeof showNotification === 'function') {
            showNotification('Канал удален', 'success', 'Успешно');
        }
        if (typeof closeBloggerCardModal === 'function') {
            closeBloggerCardModal();
        }
        setTimeout(async () => {
            console.log('🔄 Reloading profile after first channel deletion...');
            if (typeof loadProfile === 'function') {
                await loadProfile();
                console.log('✅ Profile reloaded');
            } else if (typeof window.loadProfile === 'function') {
                await window.loadProfile();
                console.log('✅ Profile reloaded (via window)');
            }
            if (typeof loadProfileChannels === 'function') {
                await loadProfileChannels();
                console.log('✅ Profile channels reloaded');
            } else if (typeof window.loadProfileChannels === 'function') {
                await window.loadProfileChannels();
                console.log('✅ Profile channels reloaded (via window)');
            }
        }, 100);
    } catch (error) {
        console.error('Error deleting first channel:', error);
        if (typeof showNotification === 'function') {
            showNotification('Не удалось удалить канал', 'error', 'Ошибка');
        }
    }
}
window.deleteFirstChannel = deleteFirstChannel;
async function addNewChannel() {
    console.log('Add new channel clicked');
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }
    if (typeof closeBloggerCardModal === 'function') {
        closeBloggerCardModal();
    }
    if (typeof closeChannelSettingsModal === 'function') {
        closeChannelSettingsModal();
    }
    setTimeout(() => {
        if (typeof openBloggerApplicationModal === 'function') {
            openBloggerApplicationModal();
        } else {
            console.error('openBloggerApplicationModal function not found');
        }
    }, 300);
}
window.addNewChannel = addNewChannel;
window.openAddChannelModal = addNewChannel;
function generateWeekCalendar() {
    const calendar = document.getElementById('week-calendar');
    if (!calendar) return;
    const baseWeekShorts = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const weekDays = baseWeekShorts.map((code) => {
        const labels = getScheduleWeekdayLabels(code);
        return {
            short: code,           // Краткий служебный код (Пн, Вт, ...)
            full: labels.full,     // Полное локализованное название
            displayShort: labels.short // Краткое локализованное название
        };
    });
    calendar.innerHTML = '';
    const createDayButton = (day) => {
        const short = day.short;
        const times = scheduleTimesByDay[short] || { from: '00:00', to: '23:59' };
        const timeLabel = `${times.from}-${times.to}`;
        const labels = getScheduleWeekdayLabels(short);
        const btn = document.createElement('button');
        btn.className = 'week-day-btn';
        btn.dataset.day = labels.full || day.full;
        btn.dataset.dayShort = short;
        btn.innerHTML = `
            <div class="week-day-info">
                <div class="week-day-name">${labels.short || day.displayShort || day.short}</div>
                <div class="week-day-date">${timeLabel}</div>
            </div>
            <div class="week-day-status">
                <i data-lucide="circle"></i>
            </div>
        `;
        let pressTimer = null;
        const startPress = () => {
            btn._longPressTriggered = false;
            pressTimer = setTimeout(() => {
                btn._longPressTriggered = true;
                openTimeEditForDay(btn);
            }, 500);
        };
        const endPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };
        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('touchstart', startPress, { passive: true });
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', endPress);
        btn.addEventListener('touchend', endPress);
        btn.addEventListener('touchcancel', endPress);
        btn.addEventListener('click', (e) => {
            if (btn._longPressTriggered) {
                e.preventDefault();
                e.stopPropagation();
                btn._longPressTriggered = false;
                return;
            }
            toggleScheduleDay(btn);
        });
        if (selectedScheduleDays.includes(day.short)) {
            btn.classList.add('selected');
            const icon = btn.querySelector('.week-day-status i');
            if (icon) {
                icon.setAttribute('data-lucide', 'check-circle');
            }
        }
        return btn;
    };
    const monday = weekDays[0];
    const mondayRow = document.createElement('div');
    mondayRow.className = 'week-calendar-row week-calendar-row-single';
    mondayRow.appendChild(createDayButton(monday));
    calendar.appendChild(mondayRow);
    const remainingDays = weekDays.slice(1);
    for (let i = 0; i < remainingDays.length; i += 2) {
        const row = document.createElement('div');
        row.className = 'week-calendar-row';
        row.appendChild(createDayButton(remainingDays[i]));
        if (remainingDays[i + 1]) {
            row.appendChild(createDayButton(remainingDays[i + 1]));
        }
        calendar.appendChild(row);
    }
    setTimeout(() => {
        if (window.lucide) {
            lucide.createIcons();
        }
    }, 50);
}
function toggleScheduleDay(button) {
    const dayShort = button.dataset.dayShort;
    const isSelected = button.classList.contains('selected');
    if (isSelected) {
        button.classList.remove('selected');
        selectedScheduleDays = selectedScheduleDays.filter(d => d !== dayShort);
        const icon = button.querySelector('.week-day-status i');
        if (icon) {
            icon.setAttribute('data-lucide', 'circle');
        }
    } else {
        button.classList.add('selected');
        if (!selectedScheduleDays.includes(dayShort)) {
            selectedScheduleDays.push(dayShort);
        }
        if (!scheduleTimesByDay[dayShort]) {
            scheduleTimesByDay[dayShort] = { from: '00:00', to: '23:59' };
        }
        const icon = button.querySelector('.week-day-status i');
        if (icon) {
            icon.setAttribute('data-lucide', 'check-circle');
        }
    }
    if (window.lucide) {
        lucide.createIcons();
    }
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }
}
async function saveSchedule() {
    console.log('Selected schedule days:', selectedScheduleDays);
    if (currentTimeEditDayShort && currentTimeEditButton) {
        const saved = await saveTimeForDay();
        if (!saved) {
            return;
        }
    }
    if (selectedScheduleDays.length === 0) {
        showNotification('Выберите хотя бы один день', 'info', 'Внимание');
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('warning');
        }
        return;
    }
    const schedulePayload = selectedScheduleDays.map(short => {
        const times = scheduleTimesByDay[short] || { from: '00:00', to: '23:59' };
        return {
            weekday_short: short,
            from_time: times.from,
            to_time: times.to
        };
    });
    try {
        let backendError = null;
        if (typeof authenticatedFetch === 'function') {
            const response = await authenticatedFetch('/api/blogger/schedule', {
                method: 'POST',
                body: JSON.stringify({ schedule: schedulePayload })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                backendError = data.error || 'Ошибка, введите время в верном формате';
            }
        }
        if (backendError) {
            showNotification(backendError, 'error', 'Ошибка');
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
            }
            return;
        }
        showNotification(
            `График постов настроен на ${selectedScheduleDays.length} ${getDayWord(selectedScheduleDays.length)}`,
            'success',
            'Успешно'
        );
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
        closeScheduleModal();
    } catch (error) {
        console.error('Error saving schedule:', error);
        showNotification('Ошибка, введите время в верном формате', 'error', 'Ошибка');
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
        }
    }
}
function getDayWord(count) {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return 'дней';
    }
    if (lastDigit === 1) {
        return 'день';
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
        return 'дня';
    }
    return 'дней';
}
async function loadScheduleFromServer() {
    try {
        const response = await authenticatedFetch('/api/blogger/schedule');
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        const schedule = data.schedule || [];
        scheduleTimesByDay = {};
        selectedScheduleDays = [];
        schedule.forEach(item => {
            const short = (item.weekday_short || '').trim();
            const from = (item.from_time || '00:00').trim();
            const to = (item.to_time || '23:59').trim();
            if (!short) return;
            scheduleTimesByDay[short] = { from, to };
            if (!selectedScheduleDays.includes(short)) {
                selectedScheduleDays.push(short);
            }
        });
        const buttons = document.querySelectorAll('.week-day-btn');
        buttons.forEach(btn => {
            const short = btn.dataset.dayShort;
            if (!short) return;
            const isSelected = selectedScheduleDays.includes(short);
            const icon = btn.querySelector('.week-day-status i');
            const timeLabelEl = btn.querySelector('.week-day-date');
            const times = scheduleTimesByDay[short] || { from: '00:00', to: '23:59' };
            const timeLabel = `${times.from}-${times.to}`;
            if (isSelected) {
                btn.classList.add('selected');
                if (icon) icon.setAttribute('data-lucide', 'check-circle');
            } else {
                btn.classList.remove('selected');
                if (icon) icon.setAttribute('data-lucide', 'circle');
            }
            if (timeLabelEl) {
                timeLabelEl.textContent = timeLabel;
            }
        });
        if (window.lucide) {
            lucide.createIcons();
        }
    } catch (error) {
        console.error('Error loading schedule from server:', error);
    }
}
function openTimeEditForDay(button) {
    const container = document.getElementById('time-range-slider-container');
    const dayLabelEl = document.getElementById('time-range-day-label');
    const fromDisplay = document.getElementById('time-from-display');
    const toDisplay = document.getElementById('time-to-display');
    const sliderFrom = document.getElementById('slider-from');
    const sliderTo = document.getElementById('slider-to');
    if (!container || !dayLabelEl || !fromDisplay || !toDisplay || !sliderFrom || !sliderTo) return;
    const short = button.dataset.dayShort;
    const full = button.dataset.day || short;
    currentTimeEditDayShort = short;
    currentTimeEditButton = button;
    dayLabelEl.textContent = full;
    const existing = scheduleTimesByDay[short] || { from: '00:00', to: '23:59' };
    const fromMinutes = timeToMinutes(existing.from);
    const toMinutes = timeToMinutes(existing.to);
    fromDisplay.value = existing.from;
    toDisplay.value = existing.to;
    sliderFrom.value = fromMinutes;
    sliderTo.value = toMinutes;
    updateSliderRange();
    container.style.display = 'block';
    requestAnimationFrame(() => {
        container.classList.add('active');
    });
    setupSliderListeners();
    setupTimeInputListeners();
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }
    if (window.lucide) {
        lucide.createIcons();
    }
}
function closeTimeEdit() {
    const container = document.getElementById('time-range-slider-container');
    if (container) {
        container.classList.remove('active');
        setTimeout(() => {
            container.style.display = 'none';
        }, 300);
    }
    if (currentTimeEditDayShort && currentTimeEditButton) {
        saveTimeForDay();
    }
}
function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(n => parseInt(n, 10));
    return hours * 60 + minutes;
}
function minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
function updateSliderRange() {
    const sliderFrom = document.getElementById('slider-from');
    const sliderTo = document.getElementById('slider-to');
    const range = document.getElementById('dual-slider-range');
    if (!sliderFrom || !sliderTo || !range) return;
    const fromValue = parseInt(sliderFrom.value);
    const toValue = parseInt(sliderTo.value);
    const max = 1439; // 23:59 in minutes
    const fromPercent = (fromValue / max) * 100;
    const toPercent = (toValue / max) * 100;
    range.style.left = fromPercent + '%';
    range.style.width = (toPercent - fromPercent) + '%';
}
function updateCurrentDayButtonTimeDisplay(fromStr, toStr) {
    if (!currentTimeEditButton || !currentTimeEditDayShort) return;
    const from = (fromStr || '').trim();
    const to = (toStr || '').trim();
    if (!from || !to) return;
    const timeLabelEl = currentTimeEditButton.querySelector('.week-day-date');
    if (timeLabelEl) {
        const timeLabel = `${from}-${to}`;
        timeLabelEl.textContent = timeLabel;
    }
    scheduleTimesByDay[currentTimeEditDayShort] = { from, to };
}
function setupSliderListeners() {
    const sliderFrom = document.getElementById('slider-from');
    const sliderTo = document.getElementById('slider-to');
    const fromDisplay = document.getElementById('time-from-display');
    const toDisplay = document.getElementById('time-to-display');
    if (!sliderFrom || !sliderTo || !fromDisplay || !toDisplay) return;
    const newSliderFrom = sliderFrom.cloneNode(true);
    const newSliderTo = sliderTo.cloneNode(true);
    sliderFrom.parentNode.replaceChild(newSliderFrom, sliderFrom);
    sliderTo.parentNode.replaceChild(newSliderTo, sliderTo);
    const updatedSliderFrom = document.getElementById('slider-from');
    const updatedSliderTo = document.getElementById('slider-to');
    const updatedFromDisplay = document.getElementById('time-from-display');
    const updatedToDisplay = document.getElementById('time-to-display');
    const updateFromSlider = () => {
        const fromDisplay = document.getElementById('time-from-display');
        const toDisplay = document.getElementById('time-to-display');
        const sliderFrom = document.getElementById('slider-from');
        const sliderTo = document.getElementById('slider-to');
        if (!fromDisplay || !sliderFrom || !sliderTo) return;
        let fromValue = parseInt(sliderFrom.value);
        let toValue = parseInt(sliderTo.value);
        if (fromValue >= toValue) {
            fromValue = toValue - 1;
            sliderFrom.value = fromValue;
        }
        fromDisplay.value = minutesToTime(fromValue);
        updateSliderRange();
        if (toDisplay) {
            updateCurrentDayButtonTimeDisplay(fromDisplay.value, toDisplay.value);
        }
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.selectionChanged();
        }
    };
    const updateToSlider = () => {
        const fromDisplay = document.getElementById('time-from-display');
        const toDisplay = document.getElementById('time-to-display');
        const sliderFrom = document.getElementById('slider-from');
        const sliderTo = document.getElementById('slider-to');
        if (!toDisplay || !sliderFrom || !sliderTo) return;
        let fromValue = parseInt(sliderFrom.value);
        let toValue = parseInt(sliderTo.value);
        if (toValue <= fromValue) {
            toValue = fromValue + 1;
            sliderTo.value = toValue;
        }
        toDisplay.value = minutesToTime(toValue);
        updateSliderRange();
        if (fromDisplay) {
            updateCurrentDayButtonTimeDisplay(fromDisplay.value, toDisplay.value);
        }
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.selectionChanged();
        }
    };
    updatedSliderFrom.addEventListener('input', updateFromSlider);
    updatedSliderTo.addEventListener('input', updateToSlider);
}
function setupTimeInputListeners() {
    const fromDisplay = document.getElementById('time-from-display');
    const toDisplay = document.getElementById('time-to-display');
    const sliderFrom = document.getElementById('slider-from');
    const sliderTo = document.getElementById('slider-to');
    if (!fromDisplay || !toDisplay || !sliderFrom || !sliderTo) return;
    const newFromDisplay = fromDisplay.cloneNode(true);
    const newToDisplay = toDisplay.cloneNode(true);
    fromDisplay.parentNode.replaceChild(newFromDisplay, fromDisplay);
    toDisplay.parentNode.replaceChild(newToDisplay, toDisplay);
    const updatedFromDisplay = document.getElementById('time-from-display');
    const updatedToDisplay = document.getElementById('time-to-display');
    const updatedSliderFrom = document.getElementById('slider-from');
    const updatedSliderTo = document.getElementById('slider-to');
    attachTimeInputMask(updatedFromDisplay);
    attachTimeInputMask(updatedToDisplay);
    const scrollInputIntoView = (el) => {
        try {
            const container = document.querySelector('.schedule-modal-content') || document.getElementById('schedule-modal');
            if (!el || !container) return;
            setTimeout(() => {
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }, 80);
        } catch (e) {
            console.warn('scrollIntoView failed', e);
        }
    };
    const handleFromDisplayChange = () => {
        const fromDisplay = document.getElementById('time-from-display');
        const sliderFrom = document.getElementById('slider-from');
        const sliderTo = document.getElementById('slider-to');
        if (!fromDisplay || !sliderFrom || !sliderTo) return;
        const timeStr = fromDisplay.value.trim();
        const timeRegex = /^\d{2}:\d{2}$/;
        if (timeRegex.test(timeStr)) {
            let [h, m] = timeStr.split(':').map(n => parseInt(n, 10));
            if (!Number.isInteger(h)) h = 0;
            if (!Number.isInteger(m)) m = 0;
            if (h < 0) h = 0;
            if (h > 23) h = 23;
            if (m < 0) m = 0;
            if (m > 59) m = 59;
            let minutes = h * 60 + m;
            const toMinutes = parseInt(sliderTo.value);
            if (!isNaN(toMinutes) && minutes >= toMinutes) {
                minutes = Math.max(0, toMinutes - 1);
            }
            const normalized = minutesToTime(minutes);
            fromDisplay.value = normalized;
            sliderFrom.value = minutes;
            updateSliderRange();
            const toDisplay = document.getElementById('time-to-display');
            if (toDisplay) {
                updateCurrentDayButtonTimeDisplay(fromDisplay.value, toDisplay.value);
            }
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
            }
        }
    };
    const handleToDisplayChange = () => {
        const toDisplay = document.getElementById('time-to-display');
        const sliderTo = document.getElementById('slider-to');
        const sliderFrom = document.getElementById('slider-from');
        if (!toDisplay || !sliderTo || !sliderFrom) return;
        const timeStr = toDisplay.value.trim();
        const timeRegex = /^\d{2}:\d{2}$/;
        if (timeRegex.test(timeStr)) {
            let [h, m] = timeStr.split(':').map(n => parseInt(n, 10));
            if (!Number.isInteger(h)) h = 0;
            if (!Number.isInteger(m)) m = 0;
            if (h < 0) h = 0;
            if (h > 23) h = 23;
            if (m < 0) m = 0;
            if (m > 59) m = 59;
            let minutes = h * 60 + m;
            const fromMinutes = parseInt(sliderFrom.value);
            if (!isNaN(fromMinutes) && minutes <= fromMinutes) {
                minutes = Math.min(1439, fromMinutes + 1);
            }
            const normalized = minutesToTime(minutes);
            toDisplay.value = normalized;
            sliderTo.value = minutes;
            updateSliderRange();
            const fromDisplay = document.getElementById('time-from-display');
            if (fromDisplay) {
                updateCurrentDayButtonTimeDisplay(fromDisplay.value, toDisplay.value);
            }
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
            }
        }
    };
    updatedFromDisplay.addEventListener('change', handleFromDisplayChange);
    updatedFromDisplay.addEventListener('blur', () => {
        handleFromDisplayChange();
        if (document && document.body) {
            setTimeout(() => {
                document.body.classList.remove('keyboard-open');
            }, 150);
        }
    });
    updatedFromDisplay.addEventListener('focus', () => {
        if (document && document.body) {
            document.body.classList.add('keyboard-open');
        }
        scrollInputIntoView(updatedFromDisplay);
    });
    updatedToDisplay.addEventListener('change', handleToDisplayChange);
    updatedToDisplay.addEventListener('blur', () => {
        handleToDisplayChange();
        if (document && document.body) {
            setTimeout(() => {
                document.body.classList.remove('keyboard-open');
            }, 150);
        }
    });
    updatedToDisplay.addEventListener('focus', () => {
        if (document && document.body) {
            document.body.classList.add('keyboard-open');
        }
        scrollInputIntoView(updatedToDisplay);
    });
}
async function saveTimeForDay() {
    if (!currentTimeEditDayShort || !currentTimeEditButton) {
        return false;
    }
    const fromDisplay = document.getElementById('time-from-display');
    const toDisplay = document.getElementById('time-to-display');
    if (!fromDisplay || !toDisplay) {
        return false;
    }
    const from = (fromDisplay.value || '').trim();
    const to = (toDisplay.value || '').trim();
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(from) || !timeRegex.test(to)) {
        showNotification('Введите время в формате ЧЧ:ММ', 'error', 'Неверный формат');
        return false;
    }
    const [fromH, fromM] = from.split(':').map(n => parseInt(n, 10));
    const [toH, toM] = to.split(':').map(n => parseInt(n, 10));
    const isValidPart = (h, m) =>
        Number.isInteger(h) && Number.isInteger(m) &&
        h >= 0 && h <= 23 && m >= 0 && m <= 59;
    if (!isValidPart(fromH, fromM) || !isValidPart(toH, toM)) {
        showNotification('Время должно быть в диапазоне от 00:00 до 23:59', 'error', 'Неверное время');
        return false;
    }
    scheduleTimesByDay[currentTimeEditDayShort] = { from, to };
    if (!selectedScheduleDays.includes(currentTimeEditDayShort)) {
        selectedScheduleDays.push(currentTimeEditDayShort);
    }
    currentTimeEditButton.classList.add('selected');
    const icon = currentTimeEditButton.querySelector('.week-day-status i');
    if (icon) {
        icon.setAttribute('data-lucide', 'check-circle');
    }
    const timeLabelEl = currentTimeEditButton.querySelector('.week-day-date');
    if (timeLabelEl) {
        timeLabelEl.textContent = `${from}-${to}`;
    }
    currentTimeEditDayShort = null;
    currentTimeEditButton = null;
    return true;
}
function triggerChannelPhotoUpload() {
    const photoUpload = document.getElementById('channel-photo-upload');
    if (photoUpload) {
        photoUpload.click();
    }
}
async function uploadChannelPhoto(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        if (typeof showNotification === 'function') {
            showNotification('Размер файла не должен превышать 5 МБ', 'error', 'Файл слишком большой');
        }
        return;
    }
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        if (typeof showNotification === 'function') {
            showNotification('Поддерживаются только изображения (PNG, JPG, GIF, WEBP)', 'error', 'Неверный формат');
        }
        return;
    }
    if (typeof showNotification === 'function') {
        showNotification('Загружаем фото...', 'info', 'Загрузка', 2000);
    }
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }
    try {
        const channelId = window.currentChannelData?.id;
        if (!channelId) {
            throw new Error('Channel ID not found');
        }
        const formData = new FormData();
        formData.append('photo', file);
        const response = await fetch(`/api/blogger/channels/${channelId}/photo/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `tma ${initDataRaw}`
            },
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            const channelSettingsImg = document.getElementById('channel-settings-img');
            const channelPhotoPlaceholder = document.getElementById('channel-photo-placeholder');
            if (channelSettingsImg && data.photo_url) {
                channelSettingsImg.src = data.photo_url;
                channelSettingsImg.classList.add('active');
                channelSettingsImg.onerror = function() {
                    console.warn('Failed to load uploaded photo:', data.photo_url);
                    channelSettingsImg.classList.remove('active');
                    if (channelPhotoPlaceholder) {
                        channelPhotoPlaceholder.classList.remove('hidden');
                    }
                };
            }
            if (channelPhotoPlaceholder) {
                channelPhotoPlaceholder.classList.add('hidden');
            }
            if (window.currentChannelData) {
                window.currentChannelData.channel_photo_url = data.photo_url;
            }
            if (typeof showNotification === 'function') {
                showNotification('Фото успешно загружено!', 'success', 'Успех');
            }
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
            if (typeof loadBloggerChannels === 'function') {
                loadBloggerChannels();
            }
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Error uploading channel photo:', error);
        if (typeof showNotification === 'function') {
            showNotification('Не удалось загрузить фото', 'error', 'Ошибка загрузки');
        }
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
        }
    }
}
if (typeof window !== 'undefined') {
    window.openScheduleModal = openScheduleModal;
    window.closeScheduleModal = closeScheduleModal;
    window.addNewChannel = addNewChannel;
    window.openChannelVerificationModal = openChannelVerificationModal;
    window.closeChannelVerificationModal = closeChannelVerificationModal;
    window.verifyChannel = verifyChannel;
    window.loadBloggerChannels = loadBloggerChannels;
    window.openChannelDetailModal = openChannelDetailModal;
    window.openChannelSettingsModal = openChannelSettingsModal;
    window.updateChannelModalUI = updateChannelModalUI;
    window.saveSchedule = saveSchedule;
    window.closeTimeEdit = closeTimeEdit;
    window.triggerChannelPhotoUpload = triggerChannelPhotoUpload;
    window.uploadChannelPhoto = uploadChannelPhoto;
    console.log('Schedule.js functions exported to window');
}
