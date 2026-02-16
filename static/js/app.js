// Telegram WebApp initialization
let tg = window.Telegram?.WebApp;
let userData = null;
let initDataRaw = null;
let currentUserIsBlogger = false; // обновляется из checkBloggerStatus

// ===== VIBRATION / HAPTIC HELPERS =====

// Check if vibration is enabled in settings (default: enabled)
function isVibrationEnabled() {
    try {
        return localStorage.getItem('vibration_enabled') !== 'false';
    } catch (e) {
        return true;
    }
}

// Trigger Web Vibration API with a given pattern (number or array)
function triggerVibration(pattern) {
    if (!isVibrationEnabled()) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            console.warn('Vibration failed', e);
        }
    }
}

// Wrap Telegram HapticFeedback so it also respects vibration setting
let hapticsWrapped = false;
function setupHapticsWrapper() {
    if (hapticsWrapped) return;
    if (!tg || !tg.HapticFeedback) return;

    const hf = tg.HapticFeedback;

    const originalImpact = hf.impactOccurred ? hf.impactOccurred.bind(hf) : null;
    hf.impactOccurred = function(style) {
        if (!isVibrationEnabled()) return;
        if (originalImpact) originalImpact(style);
    };

    const originalNotification = hf.notificationOccurred ? hf.notificationOccurred.bind(hf) : null;
    hf.notificationOccurred = function(type) {
        if (!isVibrationEnabled()) return;
        if (originalNotification) originalNotification(type);
    };

    const originalSelection = hf.selectionChanged ? hf.selectionChanged.bind(hf) : null;
    hf.selectionChanged = function() {
        if (!isVibrationEnabled()) return;
        if (originalSelection) originalSelection();
    };

    hapticsWrapped = true;
}

// Detect platform (used for small iOS-only layout tweaks)
function applyPlatformClass() {
    try {
        const root = document.documentElement;
        if (!root) return;

        const tgPlatform = tg?.platform || '';
        const ua = navigator.userAgent || '';
        const isIOS =
            /iPhone|iPad|iPod/i.test(ua) ||
            tgPlatform === 'ios' ||
            tgPlatform === 'macos';

        if (isIOS) {
            root.classList.add('ios-platform');
        } else {
            root.classList.add('non-ios-platform');
        }
    } catch (e) {
        console.warn('Platform detection failed', e);
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    applyPlatformClass();
    initTelegramWebApp();
    initNavigation();
    initFilters();
    initTopicsMenu();
    initSearch();
    initOfferPage();
    loadUserProfile();
    loadUserBalance();
    preloadModalAnimations(); // Предзагрузка анимаций
    loadLanguagePreference(); // Загрузка языковых настроек
    // Wait slightly for auth data to be ready before loading bloggers
    setTimeout(loadBloggers, 500);
    
    // Initialize Lucide icons for balance pill on Buy page
    setTimeout(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, 100);
    
    // Initialize chat input Enter key handler
    const chatInput = document.getElementById('chat-message-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }
    
    // Check URL parameters for direct chat opening
    checkChatParameter();
});

// Telegram WebApp initialization
function initTelegramWebApp() {
    if (tg) {
        tg.ready();
        tg.expand();

        // Ensure Telegram haptics respect user vibration setting
        setupHapticsWrapper();
        
        // Make app fullscreen - hide Telegram header
        tg.setHeaderColor('#0f0f0f');
        tg.setBackgroundColor('#0f0f0f');
        if (tg.isFullscreen !== undefined) {
            tg.requestFullscreen();
        }
        
        // Disable vertical swipes to prevent closing
        if (tg.disableVerticalSwipes) {
            tg.disableVerticalSwipes();
        }
        
        // Get initData for authentication
        initDataRaw = tg.initData;
        
        // Get user data from Telegram
        userData = tg.initDataUnsafe?.user;
        
        if (userData && initDataRaw) {
            console.log('Telegram user authenticated');
        } else {
            console.warn('No Telegram authentication data available');
            // Show error or redirect
            showNotification('Приложение должно быть запущено через Telegram', 'warning', 'Требуется авторизация');
        }
    } else {
        // For development/testing only - remove in production
        console.warn('Telegram WebApp not available - development mode');
        // In production, you should show an error here
        showNotification('Приложение должно быть запущено через Telegram', 'warning', 'Требуется Telegram');
    }
}

// Helper function to make authenticated requests
async function authenticatedFetch(url, options = {}) {
    // Check if we have initData
    if (!initDataRaw) {
        throw new Error('No authentication data available');
    }
    
    // Add Authorization header
    const headers = {
        ...options.headers,
        'Authorization': `tma ${initDataRaw}`
    };
    
    // Only add Content-Type if not sending FormData
    // (FormData sets its own Content-Type with boundary)
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    
    // Make request with auth header
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    // Handle 401 errors
    if (response.status === 401) {
        showNotification('Пожалуйста, перезапустите приложение', 'error', 'Ошибка авторизации');
        throw new Error('Unauthorized');
    }
    
    return response;
}

// Load user profile
async function loadUserProfile() {
    try {
        // Check if we have authentication data
        if (!initDataRaw) {
            console.error('No authentication data available');
            return;
        }
        
        // Fetch user profile from server (validated by server)
        const response = await authenticatedFetch('/api/user/profile');
        
        if (!response.ok) {
            throw new Error('Failed to load profile');
        }
        
        const userProfile = await response.json();
        
        // Update userData with server-validated data
        userData = userProfile;
        if (userProfile && (userProfile.id || userProfile.user_id)) {
            window.currentUserId = userProfile.id || userProfile.user_id;
        }
        
        // Display user data
        const userName = document.getElementById('user-name');
        const userUsername = document.getElementById('user-username');
        const userAvatar = document.getElementById('user-avatar');
        
        // Set name
        const fullName = `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim();
        userName.textContent = fullName || 'Пользователь';
        
        // Set username
        const username = userProfile.username ? `@${userProfile.username}` : `ID: ${userProfile.id}`;
        userUsername.textContent = username;
        
        // Set avatar
        if (userProfile.photo_url) {
            userAvatar.src = userProfile.photo_url;
        } else {
            // Generate avatar from name
            userAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=2481cc&color=fff&size=200`;
        }
        
        // Check if user is blogger and update button
        await checkBloggerStatus();
        
        // Load stats
        await loadUserStats();
    } catch (error) {
        console.error('Error loading profile:', error);
        showNotification('Не удалось загрузить данные профиля', 'error', 'Ошибка загрузки');
    }
}

// Load user statistics
async function loadUserStats() {
    try {
        const response = await authenticatedFetch('/api/user/stats');
        
        if (!response.ok) {
            throw new Error('Failed to load stats');
        }
        
        const data = await response.json();
        
        // Update profile stats with new grid structure
        const totalOrdersValue = Math.floor(data.total_orders || 0);
        document.getElementById('total-orders').textContent = totalOrdersValue.toString();
        
        // Update spent amount in new structure (без копеек, красиво форматируем)
        const totalSpentElement = document.getElementById('total-spent');
        const amountSpan = totalSpentElement.querySelector('.stat-amount');
        if (amountSpan) {
            const rawSpent = Number(data.total_spent || 0);
            const normalizedSpent = rawSpent < 0 ? 0 : rawSpent;
            const formattedSpent = Math.floor(normalizedSpent).toLocaleString('ru-RU', {
                maximumFractionDigits: 0
            });
            amountSpan.textContent = formattedSpent;
        }
        
        // Update square buttons counters
        const squareButtons = document.querySelectorAll('.square-btn');
        squareButtons.forEach((btn, index) => {
            const countElement = btn.querySelector('.square-btn-count');
            if (countElement) {
                if (index === 0) {
                    // First button - История заказов
                    countElement.textContent = Math.floor(data.total_orders || 0);
                } else if (index === 1) {
                    // Second button - Активная реклама
                    countElement.textContent = Math.floor(data.active_ads || 0);
                }
            }
        });
        
    } catch (error) {
        console.error('Error loading user stats:', error);
        // Set default values on error
        document.getElementById('total-orders').textContent = '0';
        
        // Set default spent amount in new structure
        const totalSpentElement = document.getElementById('total-spent');
        const amountSpan = totalSpentElement.querySelector('.stat-amount');
        if (amountSpan) {
            amountSpan.textContent = '0';
        }
        
        // Set default square button counters
        const squareButtons = document.querySelectorAll('.square-btn');
        squareButtons.forEach(btn => {
            const countElement = btn.querySelector('.square-btn-count');
            if (countElement) {
                countElement.textContent = '0';
            }
        });
    }
}

// Утилита для форматирования баланса в "К" для компактного отображения в плашке
function formatBalanceCompact(value) {
    const num = Number(value) || 0;
    if (Math.abs(num) >= 10000) {
        // Округляем до сотен, затем получаем тысячи с одной цифрой после запятой
        // Пример: 97 040 → 97,0К; 97 050 → 97,1К
        const roundedHundreds = Math.round(num / 100); // шаг 100 ₽
        const k = roundedHundreds / 10; // одна цифра после запятой в "К"
        const formattedK = k.toLocaleString('ru-RU', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
        });
        return `${formattedK}К`;
    }
    // До 10 000 показываем полное число без копеек
    return num.toLocaleString('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

// Load user balance for profile header pill
async function loadUserBalance() {
    try {
        if (!initDataRaw) {
            console.error('No authentication data available for balance');
            return;
        }
        
        const response = await authenticatedFetch('/api/user/balance');
        if (!response.ok) {
            throw new Error('Failed to load balance');
        }
        
        const data = await response.json();
        
        // Update balance in profile page
        const balanceElement = document.getElementById('user-balance');
        if (balanceElement) {
            const rawBalance = data.balance ?? 0;
            const formatted = formatBalanceCompact(rawBalance);
            balanceElement.textContent = formatted;
        }
        
        // Update balance in buy page
        const balanceElementBuy = document.getElementById('user-balance-buy');
        if (balanceElementBuy) {
            const rawBalance = data.balance ?? 0;
            const formatted = formatBalanceCompact(rawBalance);
            balanceElementBuy.textContent = formatted;
        }
    } catch (error) {
        console.error('Error loading balance:', error);
        
        // Set default for profile page
        const balanceElement = document.getElementById('user-balance');
        if (balanceElement) {
            balanceElement.textContent = '0';
        }
        
        // Set default for buy page
        const balanceElementBuy = document.getElementById('user-balance-buy');
        if (balanceElementBuy) {
            balanceElementBuy.textContent = '0';
        }
    }
}

// Navigation
function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page');
    
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetPage = button.dataset.page;
            
            // Update active states
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Show target page
            pages.forEach(page => page.classList.remove('active'));
            document.getElementById(`${targetPage}-page`).classList.add('active');
            
            // Load chats when navigating to chat page
            if (targetPage === 'chat') {
                loadChatsList();
            }
            
            // Load profile channels when navigating to profile page
            if (targetPage === 'profile' && currentUserIsBlogger) {
                console.log('📄 Navigated to profile page, loading channels...');
                loadProfileChannels();
            }
            
            // Haptic feedback
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('light');
            }
        });
    });
}

// Switch to page function (for buttons)
function switchToPage(pageName) {
    const navButtons = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page');
    
    // Update active states
    navButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.page === pageName) {
            btn.classList.add('active');
        }
    });
    
    // Show target page
    pages.forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(`${pageName}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // Load chats when navigating to chat page
    if (pageName === 'chat') {
        loadChatsList();
    }
    
    // Load profile channels when navigating to profile page
    if (pageName === 'profile' && currentUserIsBlogger) {
        console.log('📄 Switched to profile page, loading channels...');
        loadProfileChannels();
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

// Helper to show page (used from settings etc.)
function showPage(pageName) {
    switchToPage(pageName);
}

// Filters
function initFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn:not(.topic-filter-btn)');
    
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            const filter = button.dataset.filter;
            
            // Update active states (excluding topic filter button)
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Apply filter (placeholder for now)
            applyFilter(filter);
            
            // Haptic feedback
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('light');
            }
        });
    });
    
    // Initialize topic filter button
    const topicFilterBtn = document.getElementById('topic-filter-btn');
    if (topicFilterBtn) {
        topicFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTopicsDropdown();
        });
    }
    
    // Initialize overlay click handler
    const overlay = document.getElementById('topics-dropdown-overlay');
    if (overlay) {
        overlay.addEventListener('click', () => {
            const dropdown = document.getElementById('topics-dropdown');
            const btn = document.getElementById('topic-filter-btn');
            if (dropdown && btn) {
                dropdown.classList.remove('show');
                btn.classList.remove('active');
            }
        });
    }
}

// Offer page init
async function initOfferPage() {
    const offersFeed = document.getElementById('offers-feed');
    if (!offersFeed) return;

    offersFeed.innerHTML = '';

    try {
        const response = await authenticatedFetch('/api/offers/my');
        if (!response.ok) {
            throw new Error('Failed to load offers');
        }
        const data = await response.json();
        const offers = data.offers || [];

        if (!offers.length) {
            offersFeed.innerHTML = `
                <div class="coming-soon">
                    <div class="empty-icon">
                        <i data-lucide="shopping-bag"></i>
                    </div>
                    <h3>Пока нет предложений</h3>
                    <p>Нажмите «Добавить предложение», чтобы создать своё первое предложение.</p>
                </div>
            `;
        } else {
            offersFeed.innerHTML = '';
            offers.forEach((offer) => {
                const card = createOfferCardElement(offer);
                offersFeed.appendChild(card);
            });
        }

        setTimeout(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }, 0);
    } catch (error) {
        console.error('Error loading offers:', error);
        offersFeed.innerHTML = `
            <div class="coming-soon">
                <div class="empty-icon">
                    <i data-lucide="alert-circle"></i>
                </div>
                <h3>Ошибка загрузки</h3>
                <p>Не удалось загрузить предложения, попробуйте позже.</p>
            </div>
        `;
        setTimeout(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }, 0);
    }
}

// Создание DOM-элемента карточки оффера
// Карточка по структуре и стилю такая же, как карточка блогера на странице Buy:
// сверху фото, ниже 3–4 слова текста, ниже цена и тематика.
function createOfferCardElement(offer) {
    // Используем БЕЗОПАСНУЮ функцию создания карточки оффера
    return window.xssProtection.createSafeOfferCard(offer);
}

// Search
function initSearch() {
    const searchInput = document.getElementById('search-input');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            performSearch(query);
        });
        
        // Handle keyboard visibility on mobile
        searchInput.addEventListener('focus', () => {
            // Add class when keyboard opens
            document.body.classList.add('keyboard-open');
        });
        
        searchInput.addEventListener('blur', () => {
            // Remove class when keyboard closes
            document.body.classList.remove('keyboard-open');
        });
        
        // Additional handler for iOS Safari
        if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
            searchInput.addEventListener('touchstart', () => {
                setTimeout(() => {
                    document.body.classList.add('keyboard-open');
                }, 100);
            });
        }
    }
}

// Apply filter function
function applyFilter(filter) {
    console.log(`Applying filter: ${filter}`);
    
    const feed = document.getElementById('bloggers-feed');
    if (!feed) return;
    
    const cards = Array.from(feed.querySelectorAll('.blogger-card-wrapper'));
    
    if (filter === 'popular') {
        // Сортировка по популярности: от большего количества подписчиков к меньшему
        cards.sort((a, b) => {
            const subsA = parseInt(a.dataset.subscribers || '0');
            const subsB = parseInt(b.dataset.subscribers || '0');
            return subsB - subsA; // От большего к меньшему
        });
    } else if (filter === 'price') {
        // Сортировка по цене: от меньшей к большей
        cards.sort((a, b) => {
            const priceA = parseInt(a.dataset.price || '0');
            const priceB = parseInt(b.dataset.price || '0');
            return priceA - priceB; // От меньшего к большему
        });
    }
    // Если filter === 'all', оставляем исходный порядок (не сортируем)
    
    // Перестраиваем DOM в новом порядке
    cards.forEach(card => feed.appendChild(card));
}

// Perform search function
function performSearch(query) {
    console.log(`Searching for: ${query}`);
    
    // Filter existing blogger cards
    const feed = document.getElementById('bloggers-feed');
    const cards = feed.querySelectorAll('.blogger-card-wrapper');
    const lowerQuery = query.toLowerCase();
    
    cards.forEach(card => {
        const name = card.querySelector('.blogger-channel-name').textContent.toLowerCase();
        if (name.includes(lowerQuery)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// Handle "Add offer" button click on Offer page
function handleAddOfferClick() {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }

    // Открываем новый двухшаговый флоу создания предложения поста
    openOfferPostModal();
}

// Topics data structure
const TOPIC_GROUPS = {
    "news_media": {
        "title": "🔷 Новости и медиа",
        "subtopics": [
            ["world_news", "Новости мира"],
            ["city_news", "Новости городов"],
            ["economy_news", "Экономические новости"],
            ["entertainment_news", "Развлекательные новости"],
        ],
    },
    "business_finance": {
        "title": "🔷 Бизнес и финансы",
        "subtopics": [
            ["personal_finance", "Личные финансы"],
            ["investments", "Инвестиции"],
            ["trading", "Трейдинг"],
            ["crypto", "Криптовалюты"],
            ["real_estate", "Недвижимость"],
            ["entrepreneurship", "Предпринимательство"],
            ["marketing_ads", "Маркетинг и реклама"],
        ],
    },
    "education": {
        "title": "🔷 Образование",
        "subtopics": [
            ["courses", "Курсы и обучение"],
            ["exams", "ЕГЭ/ОГЭ"],
            ["languages", "Иностранные языки"],
            ["it_education", "IT-образование"],
            ["psychology", "Психология"],
            ["science_pop", "Научно-популярный контент"],
        ],
    },
    "technology": {
        "title": "🔷 Технологии",
        "subtopics": [
            ["it_news", "IT новости"],
            ["dev", "Разработка"],
            ["gadgets", "Гаджеты"],
            ["ai", "Искусственный интеллект"],
            ["cybersec", "Кибербезопасность"],
        ],
    },
    "fun": {
        "title": "🔷 Юмор и развлечения",
        "subtopics": [
            ["memes", "Мемы"],
            ["jokes", "Приколы"],
            ["entertainment_content", "Развлекательный контент"],
            ["stories", "Истории, рассказы"],
        ],
    },
    "literature": {
        "title": "🔷 Литература и творчество",
        "subtopics": [
            ["author_texts", "Авторские тексты"],
            ["writers", "Писатели, поэты"],
            ["fanfiction", "Фанфикшн"],
            ["illustrations", "Иллюстрации"],
        ],
    },
    "lifestyle": {
        "title": "🔷 Лайфстайл",
        "subtopics": [
            ["self_growth", "Саморазвитие"],
            ["motivation", "Мотивация"],
            ["relationship_psychology", "Психология отношений"],
            ["fashion", "Мода"],
            ["style", "Стиль"],
            ["travel", "Путешествия"],
        ],
    },
    "health": {
        "title": "🔷 Здоровье",
        "subtopics": [
            ["sport", "Спорт"],
            ["nutrition", "Питание"],
            ["healthy_life", "Здоровый образ жизни"],
            ["medicine", "Медицина"],
        ],
    },
    "gaming": {
        "title": "🔷 Игры и гейминг",
        "subtopics": [
            ["mobile_games", "Мобильные игры"],
            ["pc_console", "ПК и консоли"],
            ["guides_reviews", "Гайды, читы, обзоры"],
        ],
    },
    "hobbies": {
        "title": "🔷 Хобби",
        "subtopics": [
            ["music", "Музыка"],
            ["movies", "Фильмы"],
            ["anime", "Аниме"],
            ["auto_moto", "Авто/мото"],
        ],
    },
};

// Selected topics state
let selectedTopics = new Set();
let allBloggers = [];

// Initialize topics menu
function initTopicsMenu() {
    const menu = document.getElementById('topics-menu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    Object.entries(TOPIC_GROUPS).forEach(([groupKey, groupData]) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'topic-group';
        groupDiv.dataset.groupKey = groupKey;
        
        const header = document.createElement('div');
        header.className = 'topic-group-header';
        
        const title = document.createElement('div');
        title.className = 'topic-group-title';
        title.textContent = groupData.title;
        
        const arrow = document.createElement('i');
        arrow.setAttribute('data-lucide', 'chevron-down');
        arrow.className = 'topic-group-arrow';
        
        header.appendChild(title);
        header.appendChild(arrow);
        
        const subtopics = document.createElement('div');
        subtopics.className = 'topic-subtopics';
        
        groupData.subtopics.forEach(([subKey, subTitle]) => {
            const item = document.createElement('div');
            item.className = 'topic-subtopic-item';
            item.dataset.groupKey = groupKey;
            item.dataset.subKey = subKey;
            
            const check = document.createElement('i');
            check.setAttribute('data-lucide', 'check');
            check.className = 'topic-check';
            
            const name = document.createElement('div');
            name.className = 'topic-subtopic-name';
            name.textContent = subTitle;
            
            item.appendChild(check);
            item.appendChild(name);
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTopic(groupKey, subKey, item);
            });
            
            subtopics.appendChild(item);
        });
        
        header.addEventListener('click', () => {
            groupDiv.classList.toggle('expanded');
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('light');
            }
        });
        
        groupDiv.appendChild(header);
        groupDiv.appendChild(subtopics);
        menu.appendChild(groupDiv);
    });
    
    lucide.createIcons();
}

// Toggle topic selection
function toggleTopic(groupKey, subKey, element) {
    const topicKey = `${groupKey}:${subKey}`;
    
    if (selectedTopics.has(topicKey)) {
        selectedTopics.delete(topicKey);
        element.classList.remove('selected');
    } else {
        selectedTopics.add(topicKey);
        element.classList.add('selected');
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    // Apply filter
    applyTopicsFilter();
}

// Apply topics filter
function applyTopicsFilter() {
    const feed = document.getElementById('bloggers-feed');
    if (!feed) return;
    
    const cards = feed.querySelectorAll('.blogger-card-wrapper');
    
    if (selectedTopics.size === 0) {
        // Show all if no topics selected
        cards.forEach(card => {
            card.style.display = 'block';
        });
    } else {
        // Filter by selected topics
        cards.forEach(card => {
            const groupKey = card.dataset.topicGroupKey || '';
            const subKey = card.dataset.topicSubKey || '';
            
            // Only filter if we have valid topic keys
            if (!groupKey || !subKey) {
                // Hide bloggers without topic data when filtering
                card.style.display = 'none';
                return;
            }
            
            const topicKey = `${groupKey}:${subKey}`;
            if (selectedTopics.has(topicKey)) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    }
}

// Toggle topics dropdown
function toggleTopicsDropdown() {
    const dropdown = document.getElementById('topics-dropdown');
    const btn = document.getElementById('topic-filter-btn');
    const menu = dropdown?.querySelector('.topics-menu');
    
    if (!dropdown || !btn) return;
    
    if (dropdown.classList.contains('show')) {
        dropdown.classList.remove('show');
        btn.classList.remove('active');
    } else {
        // Position menu below button on the right
        if (menu) {
            const btnRect = btn.getBoundingClientRect();
            const menuWidth = 280; // max-width from CSS
            const menuRight = window.innerWidth - btnRect.right;
            const menuLeft = Math.max(20, btnRect.right - menuWidth);
            
            menu.style.top = `${btnRect.bottom + 8}px`;
            menu.style.right = `${menuRight}px`;
            menu.style.left = 'auto';
            menu.style.width = `${Math.min(menuWidth, window.innerWidth - 40)}px`;
        }
        
        dropdown.classList.add('show');
        btn.classList.add('active');
        
        // Update Lucide icons when opening
        setTimeout(() => {
            lucide.createIcons();
        }, 50);
    }
    
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Close topics dropdown when clicking outside (handled by overlay click handler in initFilters)

// Load bloggers list
async function loadBloggers() {
    console.log('🔄 loadBloggers() called');
    try {
        // Need auth data first
        if (!initDataRaw) {
            console.warn('⚠️ No initDataRaw, retrying in 500ms...');
            // Wait a bit and try again if initData not ready
            setTimeout(loadBloggers, 500);
            return;
        }

        console.log('📡 Fetching bloggers from /api/bloggers/list...');
        const response = await authenticatedFetch('/api/bloggers/list');
        console.log('📡 Response status:', response.status, response.ok);
        
        if (!response.ok) {
            console.error('❌ Response not OK:', response.status, response.statusText);
            throw new Error('Failed to load bloggers');
        }
        
        const data = await response.json();
        console.log('📊 Bloggers data received:', data);
        console.log('📊 Bloggers count:', data.bloggers ? data.bloggers.length : 0);
        
        const feed = document.getElementById('bloggers-feed');
        
        if (!feed) {
            console.error('❌ bloggers-feed element not found!');
            return;
        }
        
        console.log('✅ Feed element found');
        
        // Store all bloggers for filtering
        allBloggers = data.bloggers || [];
        console.log('📦 Stored allBloggers:', allBloggers.length);
        
        if (allBloggers.length > 0) {
            console.log('🎨 Creating blogger cards...');
            feed.innerHTML = ''; // Clear existing content
            
            allBloggers.forEach((blogger, index) => {
                console.log(`🔨 Creating card ${index + 1}/${allBloggers.length} for:`, blogger.name);
                console.log(`   📊 Blogger data from API:`, blogger); // DEBUG: Показываем все данные
                console.log(`   🔑 channel_id:`, blogger.channel_id); // DEBUG: Показываем channel_id
                
                // Подготавливаем данные блогера
                const bloggerData = {
                    id: blogger.channel_id || blogger.id, // ДОБАВЛЕНО: id канала для разделения чатов
                    channel_id: blogger.channel_id || blogger.id, // ДОБАВЛЕНО: channel_id для разделения чатов
                    user_id: blogger.user_id,
                    photo_url: blogger.image,
                    name: blogger.name,
                    subscribers: formatNumber(blogger.subscribers),
                    subscribers_raw: blogger.subscribers, // Сохраняем исходное значение для сортировки
                    price: blogger.price,
                    price_raw: blogger.raw_price || 0, // Сохраняем числовое значение цены для сортировки
                    pricePermanent: blogger.price_permanent || null,
                    channel_link: blogger.channel_link,
                    topic_group_key: blogger.topic_group_key || '',
                    topic_sub_key: blogger.topic_sub_key || '',
                    topic_sub_title: blogger.topic_sub_title || '',
                    rating: blogger.rating || 0,
                    image: blogger.image // ДОБАВЛЕНО: сохраняем image для совместимости
                };
                
                console.log(`   ✅ Prepared bloggerData:`, bloggerData); // DEBUG: Показываем подготовленные данные
                console.log(`   ✅ bloggerData.channel_id:`, bloggerData.channel_id); // DEBUG
                console.log(`   ✅ bloggerData.id:`, bloggerData.id); // DEBUG
                
                // Check if xssProtection is available
                if (!window.xssProtection || !window.xssProtection.createSafeBloggerCard) {
                    console.error('❌ window.xssProtection.createSafeBloggerCard not available!');
                    console.error('window.xssProtection:', window.xssProtection);
                    return;
                }
                
                // Используем БЕЗОПАСНУЮ функцию создания карточки
                const card = window.xssProtection.createSafeBloggerCard(bloggerData);
                
                if (!card) {
                    console.error('❌ Failed to create card for blogger:', blogger.name);
                    return;
                }
                
                // Добавляем рейтинг если есть (безопасно)
                if (bloggerData.rating > 0) {
                    const avatarWrapper = card.querySelector('.blogger-avatar-wrapper');
                    if (avatarWrapper) {
                        const badge = document.createElement('div');
                        badge.className = 'blogger-rating-badge';
                        
                        const value = document.createElement('span');
                        value.className = 'rating-value';
                        value.textContent = bloggerData.rating;
                        
                        const star = document.createElement('span');
                        star.className = 'rating-star';
                        star.textContent = '⭐';
                        
                        badge.appendChild(value);
                        badge.appendChild(star);
                        avatarWrapper.appendChild(badge);
                    }
                }
                
                feed.appendChild(card);
                console.log(`✅ Card ${index + 1} added to feed`);
            });
            
            console.log('✅ All cards created, applying topics filter...');
            // Apply topics filter if any selected
            applyTopicsFilter();
            console.log('✅ Topics filter applied');
        } else {
            console.log('⚠️ No bloggers found, showing empty state');
            feed.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px; text-align: center; color: #888;">
                    <i data-lucide="users" style="width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>Пока нет активных блогеров</p>
                </div>
            `;
            lucide.createIcons();
        }
        
        console.log('✅ loadBloggers() completed successfully');
        
    } catch (error) {
        console.error('❌ Error loading bloggers:', error);
        console.error('Error stack:', error.stack);
    }
}

// Button handlers
document.addEventListener('click', function(e) {
    // Primary buttons
    if (e.target.closest('.btn-primary')) {
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }

        const button = e.target.closest('.btn-primary');
        const buttonText = button.textContent.trim();

        // Сейчас из глобальных обработчиков нам нужен только переход
        // по кнопке "Создать заказ" на страницу Buy.
        if (buttonText.includes('Создать заказ')) {
            switchToPage('buy');
        }
        // Для остальных .btn-primary ничего дополнительно не делаем
        // (не показываем сообщение "Скоро").
    }
    
    // Toggle switches
    if (e.target.closest('.toggle-switch input')) {
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
        
        const toggle = e.target;
        const settingName = toggle.id;
        
        // Handle setting changes
        handleSettingChange(settingName, toggle.checked);
    }
});

// Handle setting changes
function handleSettingChange(settingName, isEnabled) {
    console.log(`Setting ${settingName} changed to: ${isEnabled}`);
    
    switch (settingName) {
        case 'notifications':
            // Handle notifications setting
            if (isEnabled) {
                showNotification('Вы будете получать уведомления о важных событиях', 'success', 'Уведомления включены');
            } else {
                showNotification('Вы не будете получать уведомления', 'info', 'Уведомления выключены');
            }
            break;
        case 'dark-theme':
            // Handle theme setting
            if (isEnabled) {
                showNotification('Тёмная тема уже активна', 'info', 'Тёмная тема');
            } else {
                showNotification('Светлая тема появится в следующих обновлениях', 'info', 'Скоро');
            }
            break;
    }
}

// ===== TELEGRAM-STYLE NOTIFICATION SYSTEM =====

// Show notification with Telegram-style design
function showNotification(message, type = 'info', title = null, duration = 4000) {
    console.log('🔔 showNotification called:', { message, type, title, duration });
    
    // Remove old notification if exists
    const oldNotification = document.getElementById('telegram-notification');
    if (oldNotification) {
        oldNotification.remove();
        console.log('🗑️ Old notification removed');
    }
    
    // Create new notification element
    const notification = document.createElement('div');
    notification.id = 'telegram-notification';
    
    // Use provided title or default
    const notificationTitle = title || 'Уведомление';
    
    // Set notification content
    notification.innerHTML = `
        <div class="telegram-notification-content">
            <div class="telegram-notification-text">
                <div class="telegram-notification-title">${notificationTitle}</div>
                <div class="telegram-notification-message">${message}</div>
            </div>
        </div>
    `;
    
    // КРИТИЧЕСКИ ВАЖНО: НЕ используем классы, только inline стили
    // Это гарантирует что никакие CSS правила не перебьют позиционирование
    const isMobile = window.innerWidth <= 480;
    const topPosition = isMobile ? '80px' : '90px'; // Сдвинуто ниже для кнопок Telegram
    
    // Начальная позиция - ВЫШЕ экрана
    notification.setAttribute('style', `
        all: initial;
        display: block;
        position: fixed;
        top: -100px;
        left: 50%;
        transform: translateX(-50%);
        width: calc(100% - ${isMobile ? '32px' : '48px'});
        max-width: ${isMobile ? 'none' : '380px'};
        background: rgba(30, 30, 35, 0.95);
        backdrop-filter: blur(40px) saturate(1.5);
        -webkit-backdrop-filter: blur(40px) saturate(1.5);
        border: none;
        border-radius: ${isMobile ? '20px' : '22px'};
        padding: ${isMobile ? '16px 20px' : '18px 22px'};
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3);
        z-index: 2147483647;
        opacity: 1;
        transition: top 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease;
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif;
        color: #ffffff;
        box-sizing: border-box;
        margin: 0;
        text-align: center;
    `);
    
    // Стили для внутренних элементов
    const content = notification.querySelector('.telegram-notification-content');
    if (content) {
        content.setAttribute('style', `
            all: initial;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
        `);
    }
    
    const textDiv = notification.querySelector('.telegram-notification-text');
    if (textDiv) {
        textDiv.setAttribute('style', `
            all: initial;
            display: flex;
            flex-direction: column;
            gap: 4px;
            text-align: center;
            width: 100%;
        `);
    }
    
    const titleDiv = notification.querySelector('.telegram-notification-title');
    if (titleDiv) {
        titleDiv.setAttribute('style', `
            all: initial;
            display: block;
            font-size: ${isMobile ? '17px' : '18px'};
            font-weight: 700;
            color: #ffffff;
            line-height: 1.3;
            letter-spacing: -0.5px;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-align: center;
        `);
    }
    
    const messageDiv = notification.querySelector('.telegram-notification-message');
    if (messageDiv) {
        messageDiv.setAttribute('style', `
            all: initial;
            display: block;
            font-size: ${isMobile ? '14px' : '15px'};
            font-weight: 400;
            color: rgba(255, 255, 255, 0.75);
            line-height: 1.4;
            letter-spacing: -0.2px;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-align: center;
        `);
    }
    
    // Добавляем в body ПЕРВЫМ элементом
    if (document.body.firstChild) {
        document.body.insertBefore(notification, document.body.firstChild);
    } else {
        document.body.appendChild(notification);
    }
    
    console.log('✅ Notification added to body');
    
    // Анимация появления - сдвигаем вниз
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            notification.style.top = topPosition;
            console.log('✅ Notification sliding down');
        });
    });
    
    // Haptic feedback via Telegram (already wrapped by settings)
    if (tg?.HapticFeedback) {
        switch (type) {
            case 'success':
                tg.HapticFeedback.notificationOccurred('success');
                break;
            case 'error':
                tg.HapticFeedback.notificationOccurred('error');
                break;
            case 'warning':
                tg.HapticFeedback.notificationOccurred('warning');
                break;
            default:
                tg.HapticFeedback.impactOccurred('light');
        }
    }

    // Additional short vibration for system notifications (mobile devices)
    switch (type) {
        case 'success':
            // короткая мягкая вибрация
            triggerVibration(25);
            break;
        case 'error':
            // более заметная "двойная" вибрация
            triggerVibration([40, 60, 40]);
            break;
        case 'warning':
            triggerVibration(35);
            break;
        default:
            triggerVibration(20);
    }
    
    // Auto-hide after duration
    clearTimeout(window.notificationTimeout);
    window.notificationTimeout = setTimeout(() => {
        hideTelegramNotification();
    }, duration);
}

// Hide telegram notification
function hideTelegramNotification() {
    const notification = document.getElementById('telegram-notification');
    if (notification) {
        console.log('🔼 Hiding notification - sliding up');
        
        // Анимация ухода вверх
        notification.style.top = '-100px';
        notification.style.opacity = '0';
        
        // Удаляем элемент после завершения анимации
        setTimeout(() => {
            if (notification && notification.parentNode) {
                notification.remove();
                console.log('🗑️ Notification removed from DOM');
            }
        }, 400); // Время должно совпадать с transition
    }
    
    // Clear timeout
    if (window.notificationTimeout) {
        clearTimeout(window.notificationTimeout);
    }
}

// Utility function to format numbers
function formatNumber(num) {
    // Если уже строка с K/M, парсим обратно в число
    if (typeof num === 'string') {
        if (num.endsWith('K') || num.endsWith('К')) {
            const value = parseFloat(num.replace(/[KК]/g, ''));
            num = value * 1000;
        } else if (num.endsWith('M') || num.endsWith('М')) {
            const value = parseFloat(num.replace(/[MМ]/g, ''));
            num = value * 1000000;
        }
    }
    
    const n = parseInt(num);
    if (isNaN(n)) return '0';
    
    if (n >= 1000000) {
        const millions = n / 1000000;
        const formatted = millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1);
        return formatted.replace('.', ',') + 'M';
    } else if (n >= 1000) {
        const thousands = n / 1000;
        const formatted = thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1);
        return formatted.replace('.', ',') + 'К';
    }
    return n.toString();
}

// ===== MODAL ANIMATIONS OPTIMIZATION =====

// Store animation instances and data for reuse
let modalAnimationData = null;
let ordersAnimation = null;
let adsAnimation = null;
let bloggerAnimation = null;
let purchaseAnimation = null;
let animationsPreloaded = false;

// Preload animation data once at app startup
async function preloadModalAnimations() {
    try {
        console.log('Preloading modal animations...');
        const response = await fetch('/static/TgSticker_a8d3161b.json');
        modalAnimationData = await response.json();
        animationsPreloaded = true;
        console.log('Modal animations preloaded successfully');
    } catch (error) {
        console.error('Failed to preload modal animations:', error);
        animationsPreloaded = false;
    }
}

// Initialize modal animations using preloaded data
function initModalAnimations() {
    if (!animationsPreloaded || !modalAnimationData) {
        console.warn('Animations not preloaded, falling back to URL loading');
        initModalAnimationsFallback();
        return;
    }

    // Orders modal animation
    const ordersAnimContainer = document.getElementById('modal-animation-orders');
    if (ordersAnimContainer && !ordersAnimation) {
        ordersAnimContainer.innerHTML = '';
        ordersAnimation = lottie.loadAnimation({
            container: ordersAnimContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            animationData: modalAnimationData // Используем предзагруженные данные
        });
    }
    
    // Active ads modal animation
    const adsAnimContainer = document.getElementById('modal-animation-ads');
    if (adsAnimContainer && !adsAnimation) {
        adsAnimContainer.innerHTML = '';
        adsAnimation = lottie.loadAnimation({
            container: adsAnimContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            animationData: modalAnimationData // Используем предзагруженные данные
        });
    }
}

// Fallback function for loading animations via URL (if preload failed)
function initModalAnimationsFallback() {
    // Orders modal animation
    const ordersAnimContainer = document.getElementById('modal-animation-orders');
    if (ordersAnimContainer && !ordersAnimation) {
        ordersAnimContainer.innerHTML = '';
        ordersAnimation = lottie.loadAnimation({
            container: ordersAnimContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: '/static/TgSticker_a8d3161b.json'
        });
    }
    
    // Active ads modal animation
    const adsAnimContainer = document.getElementById('modal-animation-ads');
    if (adsAnimContainer && !adsAnimation) {
        adsAnimContainer.innerHTML = '';
        adsAnimation = lottie.loadAnimation({
            container: adsAnimContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: '/static/TgSticker_a8d3161b.json'
        });
    }
    
    // Blogger application modal animation
    const bloggerAnimContainer = document.getElementById('modal-animation-blogger');
    if (bloggerAnimContainer && !bloggerAnimation) {
        bloggerAnimContainer.innerHTML = '';
        bloggerAnimation = lottie.loadAnimation({
            container: bloggerAnimContainer,
            renderer: 'svg',
            loop: true,
            autoplay: false,
            path: '/static/m11odal.json'
        });
    }
}

// Optimized animation management - pause instead of destroy
function pauseModalAnimations() {
    if (ordersAnimation) {
        ordersAnimation.pause();
    }
    if (adsAnimation) {
        adsAnimation.pause();
    }
    if (bloggerAnimation) {
        bloggerAnimation.pause();
    }
}

// Resume animations when modals are opened
function resumeModalAnimations() {
    if (ordersAnimation) {
        ordersAnimation.play();
    }
    if (adsAnimation) {
        adsAnimation.play();
    }
}

// Only destroy animations when really needed (page unload)
function destroyModalAnimations() {
    if (ordersAnimation) {
        ordersAnimation.destroy();
        ordersAnimation = null;
    }
    if (adsAnimation) {
        adsAnimation.destroy();
        adsAnimation = null;
    }
    if (bloggerAnimation) {
        bloggerAnimation.destroy();
        bloggerAnimation = null;
    }
}

// ===== ORDERS MODAL FUNCTIONALITY =====

// Open orders modal
function openOrdersModal() {
    const modalOverlay = document.getElementById('orders-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        
        // Add blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
        
        // Load orders history
        loadOrdersHistory();
    }
}

// Load orders history
async function loadOrdersHistory() {
    try {
        const response = await authenticatedFetch('/api/user/orders?limit=100');
        
        if (!response.ok) {
            throw new Error('Failed to load orders');
        }
        
        const data = await response.json();
        const orders = data.orders || [];
        
        const modalContent = document.querySelector('#orders-modal .modal-content');
        
        if (!orders.length) {
            // Show empty state
            modalContent.innerHTML = `
                <div class="orders-empty-state">
                    <div class="empty-icon">
                        <div id="modal-animation-orders"></div>
                    </div>
                    <h3>Пока нет заказов</h3>
                    <p>Ваши заказы будут отображаться здесь после их создания</p>
                    <button class="btn-primary" onclick="closeOrdersModal(); switchToPage('buy')">
                        <i data-lucide="plus"></i>
                        Создать первый заказ
                    </button>
                </div>
            `;
            
            // Initialize animation
            setTimeout(() => {
                if (!ordersAnimation || !adsAnimation) {
                    initModalAnimations();
                } else {
                    resumeModalAnimations();
                }
            }, 100);
        } else {
            // Show orders list
            modalContent.innerHTML = `
                <div class="orders-list">
                    <h3 class="orders-title">История заказов</h3>
                    <div class="orders-cards" id="orders-cards-container">
                        ${orders.map(order => createOrderCard(order)).join('')}
                    </div>
                </div>
            `;
        }
        
        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
    } catch (error) {
        console.error('Error loading orders:', error);
        showNotification('Не удалось загрузить историю заказов', 'error');
    }
}

// Create order card HTML
function createOrderCard(order) {
    const statusText = getOrderStatusText(order.status);
    const statusClass = getOrderStatusClass(order.status);
    
    // Format date
    const date = new Date(order.created_at);
    const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    // Get first 100 characters of text
    const previewText = order.post_text ? order.post_text.substring(0, 100) + (order.post_text.length > 100 ? '...' : '') : 'Нет текста';
    
    // Channel info
    const channelName = order.channel_name || `@${order.blogger_username || 'unknown'}`;
    const channelLink = order.channel_link || '#';
    const channelPhoto = order.channel_photo_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(channelName) + '&background=2481cc&color=fff&size=80';
    
    return `
        <div class="order-card">
            <div class="order-card-header">
                <span class="order-card-time">${dateStr} ${timeStr}</span>
                <span class="order-card-status ${statusClass}">${statusText}</span>
            </div>
            <div class="order-card-text">${previewText}</div>
            <div class="order-card-footer">
                <a href="${channelLink}" target="_blank" class="order-card-channel">
                    <img src="${channelPhoto}" alt="${channelName}" class="order-card-channel-avatar">
                    <span class="order-card-channel-name">${channelName}</span>
                </a>
                <span class="order-card-price">
                    ${Math.floor(order.price)} ₽
                </span>
            </div>
        </div>
    `;
}

// Get order status text
function getOrderStatusText(status) {
    const statusMap = {
        'pending': 'Ожидает',
        'approved': 'Одобрен',
        'rejected': 'Отклонен',
        'posted': 'Опубликован',
        'deleted': 'Удален',
        'completed': 'Завершен'
    };
    return statusMap[status] || status;
}

// Get order status class
function getOrderStatusClass(status) {
    const classMap = {
        'pending': 'status-pending',
        'approved': 'status-approved',
        'rejected': 'status-rejected',
        'posted': 'status-posted',
        'deleted': 'status-deleted',
        'completed': 'status-completed'
    };
    return classMap[status] || '';
}

// Close orders modal
function closeOrdersModal() {
    const modalOverlay = document.getElementById('orders-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
        
        // Remove blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        // Pause animations instead of destroying them
        pauseModalAnimations();
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// ===== BALANCE TOPUP MODAL FUNCTIONALITY =====

// Open balance topup modal
function openBalanceTopupModal() {
    const modalOverlay = document.getElementById('balance-topup-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');

    if (modalOverlay) {
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
    }
}

// Close balance topup modal
function closeBalanceTopupModal() {
    const modalOverlay = document.getElementById('balance-topup-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';

        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// Handle TON payment
function handleTonPayment() {
    try {
        // Получаем сумму из модального окна
        const amountInput = document.getElementById('topup-amount');
        if (!amountInput) {
            showNotification('Ошибка: поле ввода суммы не найдено', 'error');
            return;
        }

        const amount = parseFloat(amountInput.value);

        // Валидация суммы
        if (!amount || amount <= 0) {
            showNotification('Введите корректную сумму', 'error');
            return;
        }

        if (amount < 1) {
            showNotification('Минимальная сумма пополнения: 1 руб.', 'error');
            return;
        }

        if (amount > 100000) {
            showNotification('Максимальная сумма пополнения: 100 000 руб.', 'error');
            return;
        }

        // Показываем уведомление о разработке функционала
        showNotification('Оплата через TON будет доступна в ближайшее время', 'info');
        
        // Вибрация
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('warning');
        }

        // TODO: Реализовать интеграцию с TON Connect
        console.log('TON payment requested for amount:', amount);

    } catch (error) {
        console.error('❌ Ошибка TON платежа:', error);
        showNotification(error.message || 'Ошибка создания платежа', 'error');
    }
}

// ===== ACTIVE ADS MODAL FUNCTIONALITY =====

// Open active ads modal
function openActiveAdsModal() {
    const modalOverlay = document.getElementById('active-ads-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        
        // Add blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
        
        // Load active ads
        loadActiveAds();
    }
}

// Load active ads
async function loadActiveAds() {
    try {
        const response = await authenticatedFetch('/api/user/ads');
        
        if (!response.ok) {
            throw new Error('Failed to load active ads');
        }
        
        const data = await response.json();
        const ads = data.ads || [];
        
        const modalContent = document.querySelector('#active-ads-modal .modal-content');
        
        if (!ads.length) {
            // Show empty state
            modalContent.innerHTML = `
                <div class="orders-empty-state">
                    <div class="empty-icon">
                        <div id="modal-animation-ads"></div>
                    </div>
                    <h3>Нет активной рекламы</h3>
                    <p>Ваши активные рекламные кампании будут отображаться здесь</p>
                    <button class="btn-primary" onclick="closeActiveAdsModal(); switchToPage('buy')">
                        <i data-lucide="plus"></i>
                        Запустить рекламу
                    </button>
                </div>
            `;
            
            // Initialize animation
            setTimeout(() => {
                if (!ordersAnimation || !adsAnimation) {
                    initModalAnimations();
                } else {
                    resumeModalAnimations();
                }
            }, 100);
        } else {
            // Show active ads list
            modalContent.innerHTML = `
                <div class="orders-list">
                    <h3 class="orders-title">Активная реклама</h3>
                    <div class="orders-cards" id="active-ads-cards-container">
                        ${ads.map(ad => createActiveAdCard(ad)).join('')}
                    </div>
                </div>
            `;
        }
        
        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
    } catch (error) {
        console.error('Error loading active ads:', error);
        showNotification('Не удалось загрузить активную рекламу', 'error');
    }
}

// Create active ad card HTML
function createActiveAdCard(ad) {
    const statusText = getOrderStatusText(ad.status);
    const statusClass = getOrderStatusClass(ad.status);
    
    // Format date
    const date = new Date(ad.created_at);
    const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    // Get first 100 characters of text
    const previewText = ad.post_text ? ad.post_text.substring(0, 100) + (ad.post_text.length > 100 ? '...' : '') : 'Нет текста';
    
    // Channel info
    const channelName = ad.channel_name || `@${ad.blogger_username || 'unknown'}`;
    const channelLink = ad.channel_link || '#';
    const channelPhoto = ad.channel_photo_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(channelName) + '&background=2481cc&color=fff&size=80';
    
    return `
        <div class="order-card">
            <div class="order-card-header">
                <span class="order-card-time">${dateStr} ${timeStr}</span>
                <span class="order-card-status ${statusClass}">${statusText}</span>
            </div>
            <div class="order-card-text">${previewText}</div>
            <div class="order-card-footer">
                <a href="${channelLink}" target="_blank" class="order-card-channel">
                    <img src="${channelPhoto}" alt="${channelName}" class="order-card-channel-avatar">
                    <span class="order-card-channel-name">${channelName}</span>
                </a>
                <span class="order-card-price">
                    ${Math.floor(ad.price)} ₽
                </span>
            </div>
        </div>
    `;
}

// Close active ads modal
function closeActiveAdsModal() {
    const modalOverlay = document.getElementById('active-ads-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
        
        // Remove blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        // Pause animations instead of destroying them
        pauseModalAnimations();
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// ===== BLOGGER APPLICATION MODAL FUNCTIONALITY =====

// Open blogger application modal
function openBloggerApplicationModal() {
    const modalOverlay = document.getElementById('blogger-application-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        
        // Add blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
        
        // Start blogger animation
        setTimeout(() => {
            if (!bloggerAnimation) {
                initModalAnimationsFallback(); // Initialize if not loaded
            }
            if (bloggerAnimation) {
                bloggerAnimation.goToAndPlay(0, true);
            }
        }, 100);
        
        // Re-initialize Lucide icons for dynamically loaded content
        setTimeout(() => {
            lucide.createIcons();
        }, 100);
    }
}

// Make function globally accessible
window.openBloggerApplicationModal = openBloggerApplicationModal;

// Close blogger application modal
function closeBloggerApplicationModal() {
    const modalOverlay = document.getElementById('blogger-application-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
        
        // Remove blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        // Pause blogger animation
        if (bloggerAnimation) {
            bloggerAnimation.pause();
        }
        
        // Reset form
        const form = document.getElementById('blogger-application-form');
        if (form) {
            form.reset();
        }
        
        // Reset error states
        const channelLinkInput = document.getElementById('channel-link');
        const inputWrapper = form?.querySelector('.input-wrapper');
        const formHint = form?.querySelector('.form-hint');
        
        if (channelLinkInput) {
            channelLinkInput.classList.remove('error');
        }
        if (inputWrapper) {
            inputWrapper.classList.remove('shake');
        }
        if (formHint) {
            formHint.classList.remove('emphasize');
        }
        
        // Reset modal state - show form, hide instructions
        setTimeout(() => {
            const formState = document.querySelector('.blogger-form-state');
            const instructionsState = document.getElementById('blogger-instructions');
            
            if (formState) {
                formState.classList.remove('fade-out');
                formState.style.display = 'block';
            }
            
            if (instructionsState) {
                instructionsState.style.display = 'none';
            }
        }, 300);
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// Submit blogger application
async function submitBloggerApplication(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('.input-send-btn');
    const channelLinkInput = document.getElementById('channel-link');
    const channelLink = channelLinkInput.value.trim();
    const inputWrapper = form.querySelector('.input-wrapper');
    const formHint = form.querySelector('.form-hint');
    
    // Validate URL
    if (!channelLink || !isValidTelegramUrl(channelLink)) {
        // Add error state to input
        channelLinkInput.classList.add('error');
        
        // Shake animation
        inputWrapper.classList.add('shake');
        
        // Emphasize hint
        formHint.classList.add('emphasize');
        
        // Show notification
        showNotification(
            'Пожалуйста, укажите корректную ссылку на канал', 
            'error', 
            'Неверный формат'
        );
        
        // Haptic feedback for error
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }

        // Additional double vibration for invalid link on mobile
        triggerVibration([40, 70, 40]);
        
        // Remove animations after they complete
        setTimeout(() => {
            inputWrapper.classList.remove('shake');
        }, 500);
        
        setTimeout(() => {
            formHint.classList.remove('emphasize');
        }, 1000);
        
        // Remove error state when user starts typing
        const removeErrorState = () => {
            channelLinkInput.classList.remove('error');
            channelLinkInput.removeEventListener('input', removeErrorState);
        };
        channelLinkInput.addEventListener('input', removeErrorState);
        
        return;
    }
    
    // Remove error state if present
    channelLinkInput.classList.remove('error');
    
    // Show loading state
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    try {
        // Всегда используем новый эндпоинт для добавления канала
        const endpoint = '/api/blogger/channels/add';
        
        const response = await authenticatedFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                channel_link: channelLink
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Success - show instructions with animation
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
            
            // Show success notification
            showNotification(
                'Следуйте инструкциям на экране', 
                'success', 
                'Канал добавлен!'
            );
            
            // Animate form out and instructions in
            showBloggerInstructions();
        } else {
            // Handle specific errors
            let errorMessage = 'Попробуйте позже или обратитесь в поддержку';
            let errorTitle = 'Ошибка отправки';
            
            if (data.error) {
                if (data.error.includes('уже есть активная заявка')) {
                    errorTitle = 'Заявка уже отправлена';
                    errorMessage = 'Дождитесь решения администратора';
                } else if (data.error.includes('уже являетесь блогером')) {
                    errorTitle = 'Вы уже блогер!';
                    errorMessage = 'У вас уже есть статус блогера';
                } else if (data.error.includes('корректную ссылку')) {
                    errorTitle = 'Неверная ссылка';
                    errorMessage = 'Укажите ссылку в формате t.me/channel';
                } else {
                    errorMessage = data.error;
                }
            }
            
            // Error from server
            showNotification(errorMessage, 'error', errorTitle);
        }
    } catch (error) {
        console.error('Error submitting blogger application:', error);
        showNotification(
            'Проверьте подключение к интернету', 
            'error', 
            'Ошибка соединения'
        );
    } finally {
        // Remove loading state
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// Show blogger instructions with smooth animation
function showBloggerInstructions() {
    const formState = document.querySelector('.blogger-form-state');
    const instructionsState = document.getElementById('blogger-instructions');
    
    // Fade out the form
    formState.classList.add('fade-out');
    
    // After fade out animation completes, show instructions
    setTimeout(() => {
        formState.style.display = 'none';
        instructionsState.style.display = 'block';
        
        // Re-initialize Lucide icons for the new content
        setTimeout(() => {
            lucide.createIcons();
            
            // Add click handler for bot username link
            const botUsernameLink = document.querySelector('.bot-username');
            if (botUsernameLink) {
                botUsernameLink.addEventListener('click', function(e) {
                    // Haptic feedback
                    if (tg?.HapticFeedback) {
                        tg.HapticFeedback.impactOccurred('light');
                    }
                    
                    // Open link in Telegram if possible
                    if (tg?.openTelegramLink) {
                        e.preventDefault();
                        tg.openTelegramLink('https://t.me/admarket_testbot');
                    }
                    // Otherwise let the default behavior work (open in new tab)
                });
            }
        }, 50);
    }, 500); // Match the fade-out animation duration
}

// Verify blogger channel
async function verifyBloggerChannel() {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    // Show loading notification
    showNotification(
        'Проверяем добавление бота...', 
        'info', 
        'Идет проверка',
        2000
    );
    
    try {
        // Получаем список каналов
        const channelsResponse = await authenticatedFetch('/api/blogger/channels/list');
        const channelsData = await channelsResponse.json();
        
        if (!channelsResponse.ok || !channelsData.channels || channelsData.channels.length === 0) {
            throw new Error('Не удалось найти добавленный канал');
        }
        
        // Находим последний неверифицированный канал
        const unverifiedChannel = channelsData.channels.find(ch => !ch.is_verified);
        
        if (!unverifiedChannel) {
            throw new Error('Все каналы уже верифицированы');
        }
        
        // Проверяем этот канал
        const response = await authenticatedFetch(`/api/blogger/channels/${unverifiedChannel.id}/verify`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        
        const data = await response.json();
        
        if (response.ok && data.verified) {
            // Success - bot verified
            showNotification(
                'Канал отправлен на модерацию администратору', 
                'success', 
                'Канал верифицирован!',
                5000
            );
            
            // Wait a bit before closing modal
            setTimeout(() => {
                closeBloggerApplicationModal();
                
                // Открываем обратно карточку блогера с обновленным списком
                setTimeout(() => {
                    openBloggerCardModal();
                }, 300);
            }, 1500);
        } else {
            // Not verified yet
            let warningMessage = 'Пожалуйста, следуйте инструкциям выше';
            let warningTitle = 'Бот не найден';
            
            if (data.message) {
                if (data.message.includes('не добавлен') || data.message.includes('не является администратором')) {
                    warningTitle = 'Бот не добавлен';
                    warningMessage = 'Добавьте бота администратором в канал';
                } else if (data.message.includes('Не является админом')) {
                    warningTitle = 'Недостаточно прав';
                    warningMessage = 'Выдайте боту права администратора';
                } else {
                    warningMessage = data.message;
                }
            }
            
            showNotification(warningMessage, 'warning', warningTitle, 5000);
        }
    } catch (error) {
        console.error('Error verifying blogger channel:', error);
        showNotification(
            error.message || 'Не удалось выполнить проверку, попробуйте позже', 
            'error', 
            'Ошибка проверки'
        );
    }
}

// Validate Telegram URL
function isValidTelegramUrl(url) {
    // Check if URL is valid and contains t.me or telegram.me
    const telegramPattern = /^https?:\/\/(t\.me|telegram\.me)\/.+/i;
    return telegramPattern.test(url);
}


// Prevent modal close when clicking inside modal content
document.addEventListener('click', function(e) {
    if (e.target.closest('.orders-modal')) {
        e.stopPropagation();
    }
});

// Refresh data periodically
setInterval(() => {
    if (initDataRaw && userData) {
        loadUserStats();
        loadUserBalance();
    }
}, 30000); // Refresh every 30 seconds

// Clean up animations on page unload
window.addEventListener('beforeunload', function() {
    destroyModalAnimations();
});

// ===== BLOGGER DETAIL MODAL FUNCTIONALITY =====

// Open blogger detail modal
function openBloggerModal(bloggerData) {
    console.log('🔍 openBloggerModal called with:', bloggerData); // DEBUG
    console.log('   🔑 bloggerData.channel_id:', bloggerData.channel_id); // DEBUG
    console.log('   🔑 bloggerData.id:', bloggerData.id); // DEBUG
    
    const modalOverlay = document.getElementById('blogger-detail-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        // Store blogger data globally for purchase
        window.currentBloggerUserId = bloggerData.user_id;
        window.currentBloggerData = {
            ...bloggerData,
            channel_id: bloggerData.channel_id || bloggerData.id // ИСПРАВЛЕНИЕ: явно сохраняем channel_id
        };
        
        console.log('   ✅ Saved to window.currentBloggerData:', window.currentBloggerData); // DEBUG
        console.log('   ✅ window.currentBloggerData.channel_id:', window.currentBloggerData.channel_id); // DEBUG
        
        // Set blogger data БЕЗОПАСНО
        const imgElement = document.getElementById('blogger-modal-img');
        window.xssProtection.safeSetAttribute(imgElement, 'src', bloggerData.image || bloggerData.photo_url);
        
        // Set name with link if available БЕЗОПАСНО
        const nameElement = document.getElementById('blogger-modal-name');
        nameElement.innerHTML = ''; // Очищаем
        
        if (bloggerData.channel_link) {
            const link = document.createElement('a');
            link.className = 'channel-link';
            window.xssProtection.safeSetAttribute(link, 'href', bloggerData.channel_link);
            window.xssProtection.safeSetAttribute(link, 'target', '_blank');
            link.textContent = bloggerData.name;
            nameElement.appendChild(link);
        } else {
            nameElement.textContent = bloggerData.name;
        }
        
        // Безопасно устанавливаем текстовые данные
        window.xssProtection.safeSetText(
            document.getElementById('blogger-modal-subscribers'), 
            bloggerData.subscribers
        );
        window.xssProtection.safeSetText(
            document.getElementById('blogger-modal-price'), 
            bloggerData.price
        );
        
        // Load reviews for this blogger
        loadBloggerReviews(bloggerData.user_id);
        
        // Show modal
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Add blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }
        
        // Initialize Lucide icons for the modal
        setTimeout(() => {
            lucide.createIcons();
        }, 50);
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
    }
}

// Load blogger reviews
async function loadBloggerReviews(bloggerId) {
    console.log('🔍 Loading reviews for blogger:', bloggerId);
    console.log('🔑 initDataRaw available:', !!initDataRaw);
    
    const reviewsContainer = document.getElementById('blogger-reviews-list');
    const emptyState = document.getElementById('blogger-reviews-empty');
    
    console.log('📦 Elements found:', {
        reviewsContainer: !!reviewsContainer,
        emptyState: !!emptyState
    });
    
    if (!reviewsContainer || !emptyState) {
        console.error('❌ Required elements not found!');
        return;
    }
    
    // Check if we have auth data
    if (!initDataRaw) {
        console.error('❌ No initDataRaw available, cannot load reviews');
        emptyState.style.display = 'block';
        reviewsContainer.style.display = 'none';
        return;
    }
    
    try {
        console.log('📡 Fetching reviews from API...');
        const response = await authenticatedFetch(`/api/blogger/${bloggerId}/reviews`);
        
        console.log('📥 Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API error:', errorText);
            throw new Error('Failed to load reviews');
        }
        
        const data = await response.json();
        console.log('📊 Reviews data:', data);
        
        if (data.reviews && data.reviews.length > 0) {
            console.log(`✅ Found ${data.reviews.length} reviews, rendering...`);
            
            // Hide empty state, show reviews
            emptyState.style.display = 'none';
            reviewsContainer.style.display = 'flex';
            
            // Clear existing reviews
            reviewsContainer.innerHTML = '';
            
            // Render each review
            data.reviews.forEach((review, index) => {
                console.log(`  Rendering review ${index + 1}:`, review);
                
                // Используем БЕЗОПАСНУЮ функцию создания отзыва
                const reviewItem = window.xssProtection.createSafeReviewElement(review);
                reviewsContainer.appendChild(reviewItem);
            });
            
            // Инициализируем иконки Lucide для звёзд
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            console.log('✅ Reviews rendered successfully!');
        } else {
            console.log('ℹ️ No reviews found, showing empty state');
            // Show empty state, hide reviews list
            emptyState.style.display = 'block';
            reviewsContainer.style.display = 'none';
        }
    } catch (error) {
        console.error('❌ Error loading reviews:', error);
        // Show empty state on error
        emptyState.style.display = 'block';
        reviewsContainer.style.display = 'none';
    }
}

// Close blogger detail modal
function closeBloggerModal() {
    const modalOverlay = document.getElementById('blogger-detail-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        // Remove blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// Handle buy ad action
async function handleBuyAd() {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    // Покупка идёт по стандартной цене, сбрасываем флаг оффера
    window.currentIsOffer = false;
    window.currentOfferBasePrice = null;
    
    // Check if blogger data is available
    if (!window.currentBloggerData) {
        showNotification('Ошибка: данные блогера не найдены', 'error');
        return;
    }
    
    // Close blogger modal
    closeBloggerModal();
    
    // Open purchase modal and check balance
    setTimeout(() => {
        openPurchaseModal();
    }, 300);
}

// Handle make offer action
async function handleMakeOffer() {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }

    if (!window.currentBloggerData) {
        showNotification('Ошибка: данные блогера не найдены', 'error');
        return;
    }

    // Close blogger modal and open offer modal
    closeBloggerModal();
    setTimeout(() => {
        openOfferModal();
    }, 300);
}

// Open offer modal
function openOfferModal() {
    const modalOverlay = document.getElementById('offer-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');

    if (!modalOverlay || !window.currentBloggerData) return;

    const data = window.currentBloggerData;

    // Fill channel info
    const imgEl = document.getElementById('offer-channel-img');
    const nameEl = document.getElementById('offer-channel-name');
    const subsEl = document.getElementById('offer-channel-subscribers');
    const currentPriceEl = document.getElementById('offer-current-price');
    const offerInputEl = document.getElementById('offer-price-input');

    if (imgEl) imgEl.src = data.image || '';

    if (nameEl) {
        if (data.channel_link) {
            nameEl.innerHTML = `<a href="${data.channel_link}" target="_blank" class="channel-link">${data.name}</a>`;
        } else {
            nameEl.textContent = data.name || '@channel';
        }
    }

    if (subsEl) {
        subsEl.textContent = data.subscribers ? `${data.subscribers} подписчиков` : '0 подписчиков';
    }

    if (currentPriceEl) {
        currentPriceEl.textContent = data.price || '0 ₽';
    }

    if (offerInputEl) {
        // Предзаполняем предложенную цену текущей ценой без символов
        const numericPrice = parseFloat(String(data.price || '').replace(/[₽\s]/g, '')) || '';
        offerInputEl.value = numericPrice;
        offerInputEl.focus();
    }

    // Show modal
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (pageBlurOverlay) {
        pageBlurOverlay.classList.add('active');
    }

    // Initialize icons for close button etc.
    setTimeout(() => {
        lucide.createIcons();
    }, 50);
}

// Close offer modal
function closeOfferModal() {
    const modalOverlay = document.getElementById('offer-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');

    if (!modalOverlay) return;

    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';

    if (pageBlurOverlay) {
        pageBlurOverlay.classList.remove('active');
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Back from offer to blogger card
function backFromOffer() {
    closeOfferModal();

    if (window.currentBloggerData) {
        setTimeout(() => {
            openBloggerModal(window.currentBloggerData);
        }, 250);
    }
}

// Submit offer
function submitOffer() {
    const offerInputEl = document.getElementById('offer-price-input');
    const rawValue = offerInputEl ? offerInputEl.value : '';
    const offerPrice = parseFloat(rawValue);

    if (!offerInputEl || !rawValue || isNaN(offerPrice) || offerPrice <= 0) {
        showNotification('Введите корректную сумму предложения', 'error');
        if (offerInputEl) offerInputEl.focus();
        return;
    }

    if (!window.currentBloggerData || !window.currentBloggerData.price) {
        showNotification('Ошибка: не найдена базовая цена блогера', 'error');
        return;
    }

    // Парсим базовую цену блогера
    const basePrice = parseFloat(String(window.currentBloggerData.price).replace(/[₽\s]/g, '')) || 0;

    if (basePrice > 0) {
        const minAllowed = basePrice * 0.5;
        if (offerPrice < minAllowed) {
            const minText = minAllowed.toFixed(0);
            showNotification(
                `Нельзя предложить цену ниже 50% от цены блогера. Минимально допустимо: ${minText} ₽`,
                'error'
            );
            offerInputEl.focus();
            return;
        }
    }

    // Отмечаем, что текущая покупка идёт по офферу
    window.currentIsOffer = true;
    window.currentOfferBasePrice = offerPrice;

    // Закрываем модал оффера и переходим в стандартное окно покупки
    closeOfferModal();

    // Открываем модальное окно покупки с ценой из оффера
    setTimeout(() => {
        openPurchaseModal(offerPrice);
    }, 250);
}

// Open purchase modal
async function openPurchaseModal(customPrice) {
    const modalOverlay = document.getElementById('purchase-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (!modalOverlay) return;
    
    // Show loading state
    const contentContainer = document.getElementById('purchase-modal-content');
    if (contentContainer) {
        contentContainer.innerHTML = '<div class="loading-spinner">Проверка баланса...</div>';
    }
    
    // Show modal
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.add('active');
    }
    
    // Initialize Lucide icons
    setTimeout(() => {
        lucide.createIcons();
    }, 50);
    
    // Check user balance
    try {
        const lang = localStorage.getItem('app_language') || 'ru';
        const dict = (UI_TRANSLATIONS && (UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.ru)) || {};

        const balanceResponse = await authenticatedFetch('/api/user/balance');
        if (!balanceResponse.ok) {
            throw new Error(dict.purchase_balance_check_error || 'Failed to load balance');
        }
        
        const balanceData = await balanceResponse.json();
        const userBalance = balanceData.balance ?? 0;
        
        // Get blogger price (по умолчанию — цена блогера, но можем переопределить ценой оффера)
        let bloggerPrice = 0;
        if (typeof customPrice === 'number' && !isNaN(customPrice) && customPrice > 0) {
            bloggerPrice = customPrice;
        } else if (window.currentBloggerData && window.currentBloggerData.price) {
            bloggerPrice = parseFloat(
                String(window.currentBloggerData.price).replace(/[₽\s]/g, '')
            ) || 0;
        }
        
        // Check if balance is sufficient
        if (userBalance < bloggerPrice) {
            // Insufficient balance
            showInsufficientBalanceContent(userBalance, bloggerPrice);
        } else {
            // Sufficient balance - show time selection
            showTimeSelectionContent(userBalance, bloggerPrice);
        }
    } catch (error) {
        console.error('Error checking balance:', error);
        if (contentContainer) {
            const lang = localStorage.getItem('app_language') || 'ru';
            const dict = (UI_TRANSLATIONS && (UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.ru)) || {};

            contentContainer.innerHTML = `
                <div class="error-message">
                    <i data-lucide="alert-circle"></i>
                    <p>${dict.purchase_balance_check_error || 'Ошибка при проверке баланса'}</p>
                    <button class="btn-primary" onclick="closePurchaseModal()">
                        ${dict.common_back || 'Закрыть'}
                    </button>
                </div>
            `;
            lucide.createIcons();
        }
    }
}

// Weekday helpers for purchase scheduling
const RUS_WEEK_DAYS = [
    { jsIndex: 1, short: 'Пн', full: 'Понедельник' },
    { jsIndex: 2, short: 'Вт', full: 'Вторник' },
    { jsIndex: 3, short: 'Ср', full: 'Среда' },
    { jsIndex: 4, short: 'Чт', full: 'Четверг' },
    { jsIndex: 5, short: 'Пт', full: 'Пятница' },
    { jsIndex: 6, short: 'Сб', full: 'Суббота' },
    { jsIndex: 0, short: 'Вс', full: 'Воскресенье' }
];

// UI labels for weekdays, shared between purchase day picker and schedule modal (via window.WEEKDAY_LABELS)
const WEEKDAY_LABELS = {
    ru: {
        'Пн': { short: 'Пн', full: 'Понедельник' },
        'Вт': { short: 'Вт', full: 'Вторник' },
        'Ср': { short: 'Ср', full: 'Среда' },
        'Чт': { short: 'Чт', full: 'Четверг' },
        'Пт': { short: 'Пт', full: 'Пятница' },
        'Сб': { short: 'Сб', full: 'Суббота' },
        'Вс': { short: 'Вс', full: 'Воскресенье' }
    },
    en: {
        'Пн': { short: 'Mon', full: 'Monday' },
        'Вт': { short: 'Tue', full: 'Tuesday' },
        'Ср': { short: 'Wed', full: 'Wednesday' },
        'Чт': { short: 'Thu', full: 'Thursday' },
        'Пт': { short: 'Fri', full: 'Friday' },
        'Сб': { short: 'Sat', full: 'Saturday' },
        'Вс': { short: 'Sun', full: 'Sunday' }
    },
    uk: {
        'Пн': { short: 'Пн', full: 'Понеділок' },
        'Вт': { short: 'Вт', full: 'Вівторок' },
        'Ср': { short: 'Ср', full: 'Середа' },
        'Чт': { short: 'Чт', full: 'Четвер' },
        'Пт': { short: 'Пт', full: 'Пʼятниця' },
        'Сб': { short: 'Сб', full: 'Субота' },
        'Вс': { short: 'Нд', full: 'Неділя' }
    }
};

// Экспортируем в window, чтобы schedule.js тоже мог использовать эти метки
if (typeof window !== 'undefined') {
    window.WEEKDAY_LABELS = WEEKDAY_LABELS;
}

function getLocalizedDayLabels(shortCode, langOverride) {
    const lang = langOverride || localStorage.getItem('app_language') || 'ru';
    const all = (typeof window !== 'undefined' && window.WEEKDAY_LABELS) || WEEKDAY_LABELS;
    const dict = (all && all[lang]) || (all && all.ru) || {};
    return dict[shortCode] || { short: shortCode, full: shortCode };
}

function getDayInfoFromDate(date) {
    const jsDay = date.getDay();
    const base = RUS_WEEK_DAYS.find(d => d.jsIndex === jsDay);
    const shortCode = base ? base.short : '';
    const baseFull = base ? base.full : '';
    const labels = getLocalizedDayLabels(shortCode);
    const full = labels.full || baseFull || '';
    const short = labels.short || shortCode || '';
    const lang = localStorage.getItem('app_language') || 'ru';
    const locale = lang === 'en' ? 'en-US' : lang === 'uk' ? 'uk-UA' : 'ru-RU';
    const displayDate = date.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short'
    });
    // shortCode — служебный код для маппинга расписания (всегда на русском: Пн, Вт...)
    return { full, short, shortCode, displayDate };
}

function padNumber(num) {
    return num.toString().padStart(2, '0');
}

function formatLocalDateYMD(date) {
    const year = date.getFullYear();
    const month = padNumber(date.getMonth() + 1);
    const day = padNumber(date.getDate());
    return `${year}-${month}-${day}`;
}

// State for purchase date selection
let purchaseSelectedDate = null;
let purchaseDayButtonsData = [];
let purchaseSelectedTimeMinutes = null; // Время поста в минутах с начала суток для модалки выбора дня
let currentBloggerScheduleByDay = {}; // { 'Пн': { from: '09:00', to: '18:00' }, ... } для выбранного блогера

// Загрузка расписания выбранного блогера для показа лимитов времени
async function loadCurrentBloggerSchedule() {
    currentBloggerScheduleByDay = {};

    try {
        const bloggerId = window.currentBloggerUserId;
        if (!bloggerId) {
            return;
        }

        const response = await authenticatedFetch(`/api/blogger/${bloggerId}/schedule`);
        if (!response.ok) {
            return;
        }

        const data = await response.json();
        const schedule = data.schedule || [];

        schedule.forEach(item => {
            const short = (item.weekday_short || '').trim();
            const from = (item.from_time || '00:00').trim();
            const to = (item.to_time || '23:59').trim();
            if (!short) return;
            currentBloggerScheduleByDay[short] = { from, to };
        });
    } catch (e) {
        console.error('Error loading current blogger schedule:', e);
    }
}

// Show insufficient balance content
function showInsufficientBalanceContent(currentBalance, requiredAmount) {
    const contentContainer = document.getElementById('purchase-modal-content');
    if (!contentContainer) return;
    
    const shortage = requiredAmount - currentBalance;
    const lang = localStorage.getItem('app_language') || 'ru';
    const dict = (UI_TRANSLATIONS && (UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.ru)) || {};
    const title = dict.purchase_insufficient_title || 'Недостаточно средств';
    const description =
        dict.purchase_insufficient_text || 'Для покупки рекламы необходимо пополнить баланс';
    const currentLabel = dict.purchase_current_balance_label || 'Текущий баланс:';
    const requiredLabel = dict.purchase_required_label || 'Требуется:';
    const shortageLabel = dict.purchase_shortage_label || 'Нехватает:';
    const topupBtnLabel = dict.purchase_topup_btn || 'Пополнить баланс';
    
    contentContainer.innerHTML = `
        <div class="purchase-content">
            <div class="purchase-header">
                <div class="purchase-icon insufficient">
                    <i data-lucide="alert-circle"></i>
                </div>
                <h3 class="purchase-title">${title}</h3>
                <p class="purchase-description">${description}</p>
            </div>
            
            <div class="balance-info-card">
                <div class="balance-info-row">
                    <span class="balance-info-label">${currentLabel}</span>
                    <span class="balance-info-value">${currentBalance.toFixed(2)} ₽</span>
                </div>
                <div class="balance-info-row">
                    <span class="balance-info-label">${requiredLabel}</span>
                    <span class="balance-info-value">${requiredAmount.toFixed(2)} ₽</span>
                </div>
                <div class="balance-info-divider"></div>
                <div class="balance-info-row shortage">
                    <span class="balance-info-label">${shortageLabel}</span>
                    <span class="balance-info-value">${shortage.toFixed(2)} ₽</span>
                </div>
            </div>
            
            <button class="btn-primary" onclick="topupAndReturn()">
                <i data-lucide="plus"></i>
                ${topupBtnLabel}
            </button>
        </div>
    `;
    
    lucide.createIcons();
}

// Show time selection content
function showTimeSelectionContent(currentBalance, postPrice) {
    const contentContainer = document.getElementById('purchase-modal-content');
    if (!contentContainer) return;
    
    const bloggerName = window.currentBloggerData.name || '@channel';
    const lang = localStorage.getItem('app_language') || 'ru';
    const dict = (UI_TRANSLATIONS && (UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.ru)) || {};
    const title = dict.purchase_title || 'Покупка рекламы';
    const bloggerLineTemplate = dict.purchase_blogger_label || 'Блогер: {name}';
    const bloggerLine = bloggerLineTemplate.replace('{name}', bloggerName);
    const balanceLabel = dict.purchase_balance_label || 'Ваш баланс:';
    const price24Label = dict.purchase_price_24h_label || 'Стоимость за 24 часа:';
    const totalLabel = dict.purchase_total_label || 'Итоговая стоимость:';
    const timeTitle = dict.purchase_time_title || 'Укажите время поста в ленте';
    const timeHint =
        dict.purchase_time_hint || '*по истечению этого времени пост будет удален';
    const hoursLabel = dict.purchase_hours_label || 'часов';
    const durationMin = dict.purchase_duration_min_label || '1ч';
    const durationMax = dict.purchase_duration_max_label || '24ч';
    const datetimeLabel =
        dict.purchase_datetime_label || 'Дата и время публикации';
    const dayPillDefault = dict.purchase_day_pill_default || 'День';
    const continueLabel =
        dict.purchase_continue_btn || dict.common_continue || 'Продолжить';
    
    // Сохраняем контекст баланса, цены и признака оффера
    window.currentPurchaseContext = {
        balance: currentBalance,
        postPrice: postPrice,
        bloggerPricePermanent: window.currentBloggerData?.pricePermanent || null,
        isOffer: !!window.currentIsOffer,
        offerBasePrice: window.currentIsOffer ? postPrice : null
    };
    
    contentContainer.innerHTML = `
        <div class="purchase-content">
            <div class="purchase-header">
                <div class="purchase-icon success">
                    <div id="purchase-animation"></div>
                </div>
                <h3 class="purchase-title">${title}</h3>
                <p class="purchase-description">${bloggerLine}</p>
            </div>
            
            <div class="balance-info-card">
                <div class="balance-info-row">
                    <span class="balance-info-label">${balanceLabel}</span>
                    <span class="balance-info-value">${currentBalance.toFixed(2)} ₽</span>
                </div>
                <div class="balance-info-row">
                    <span class="balance-info-label">${price24Label}</span>
                    <span class="balance-info-value">${postPrice.toFixed(2)} ₽</span>
                </div>
                <div class="balance-info-row highlight">
                    <span class="balance-info-label">${totalLabel}</span>
                    <span class="balance-info-value" id="calculated-price">${postPrice.toFixed(2)} ₽</span>
                </div>
            </div>
            
            <div class="time-selection-section">
                <h4 class="section-title">${timeTitle}</h4>
                <p class="section-subtitle">${timeHint}</p>
                
                <div class="time-slider-wrapper">
                    <div class="time-slider-display">
                        <span id="selected-hours">12</span>
                        <span class="hours-label">${hoursLabel}</span>
                    </div>
                    <div class="slider-container">
                        <input 
                            type="range" 
                            class="time-slider" 
                            id="post-duration-slider" 
                            min="0" 
                            max="3" 
                            value="0" 
                            step="1"
                            list="duration-markers"
                        >
                        <datalist id="duration-markers">
                            <option value="0" label="12ч"></option>
                            <option value="1" label="24ч"></option>
                            <option value="2" label="48ч"></option>
                            <option value="3" label="∞"></option>
                        </datalist>
                        <div class="slider-labels">
                            <span>12ч</span>
                            <span>24ч</span>
                            <span>48ч</span>
                            <span>∞</span>
                        </div>
                    </div>
                </div>
                
                <div class="post-schedule-row">
                    <label class="input-label">${datetimeLabel}</label>
                    <div class="post-schedule-buttons">
                        <button type="button" class="pill-button pill-button-day" id="post-day-button" onclick="openDayPickerModal()">
                            <span class="pill-button-dayline" id="post-day-button-label">${dayPillDefault}</span>
                            <span class="pill-button-timeline" id="post-day-button-time-label">00:00</span>
                        </button>
                    </div>
                    <!-- Скрытое поле хранит точное значение даты и времени для дальнейшей покупки -->
                    <input type="datetime-local" class="time-input" id="post-schedule-time" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                </div>
            </div>
            
            <div class="purchase-actions">
                <button class="btn-primary btn-primary-dark" onclick="confirmPurchase()">
                    <i data-lucide="shopping-cart"></i>
                    ${continueLabel}
                </button>
            </div>
        </div>
    `;
    
    // Initialize Lottie animation for purchase header icon
    const purchaseAnimContainer = document.getElementById('purchase-animation');
    if (purchaseAnimContainer && window.lottie) {
        purchaseAnimContainer.innerHTML = '';

        if (purchaseAnimation) {
            purchaseAnimation.destroy();
            purchaseAnimation = null;
        }

        purchaseAnimation = lottie.loadAnimation({
            container: purchaseAnimContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: '/static/TgSticker_f1c5f1b3.json'
        });
    }
    
    // Set minimum datetime to now
    const scheduleInput = document.getElementById('post-schedule-time');
    const dayLabelEl = document.getElementById('post-day-button-label');
    const timeLabelEl = document.getElementById('post-day-button-time-label');

    if (scheduleInput) {
        // Устанавливаем минимальное значение – текущий момент
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const isoLocal = now.toISOString().slice(0, 16);
        scheduleInput.min = isoLocal;
        scheduleInput.value = isoLocal;

        purchaseSelectedDate = new Date(now);

        const info = getDayInfoFromDate(now);
        // Кнопка "День" по умолчанию остаётся с подписью "День".
        if (timeLabelEl) {
            timeLabelEl.textContent = isoLocal.slice(11, 16);
        }

        // Обновляем кнопки при ручном изменении инпута (если браузер покажет стандартный пикер)
        scheduleInput.addEventListener('change', () => {
            if (!scheduleInput.value) return;
            const changed = new Date(scheduleInput.value);
            purchaseSelectedDate = changed;
            const changedInfo = getDayInfoFromDate(changed);
            if (dayLabelEl && changedInfo.full) {
                dayLabelEl.textContent = changedInfo.full;
            }
            if (timeLabelEl) {
                timeLabelEl.textContent = scheduleInput.value.slice(11, 16);
            }
        });
    }
    
    // Setup slider functionality
    const slider = document.getElementById('post-duration-slider');
    const selectedHoursDisplay = document.getElementById('selected-hours');
    const calculatedPriceDisplay = document.getElementById('calculated-price');
    
    if (slider && selectedHoursDisplay && calculatedPriceDisplay) {
        // Map slider values to actual hours: 0->12, 1->24, 2->48, 3->permanent (use blogger's price)
        const sliderToHours = {
            0: 12,
            1: 24,
            2: 48,
            3: -1  // -1 означает "навсегда" (без удаления)
        };
        
        const sliderToLabel = {
            0: '12',
            1: '24',
            2: '48',
            3: '∞'
        };
        
        // Get blogger's permanent price from context
        const bloggerPermanentPrice = window.currentPurchaseContext?.bloggerPricePermanent || null;
        
        // Disable "forever" option if blogger hasn't set permanent price
        const hasPermanentPrice = bloggerPermanentPrice && parseFloat(bloggerPermanentPrice) > 0;
        
        // Function to update slider background gradient
        const updateSliderBackground = (value) => {
            const percentage = ((value - slider.min) / (slider.max - slider.min)) * 100;
            slider.style.background = `linear-gradient(to right, var(--primary-blue-dark) 0%, var(--primary-blue-dark) ${percentage}%, var(--border-color) ${percentage}%, var(--border-color) 100%)`;
        };
        
        // Initialize slider background
        updateSliderBackground(slider.value);
        
        slider.addEventListener('input', function() {
            const sliderValue = parseInt(this.value);
            
            // Prevent selecting "forever" if price not set
            if (sliderValue === 3 && !hasPermanentPrice) {
                this.value = '2'; // Reset to 48h
                showNotification('Блогер не установил цену для постоянного размещения', 'warning', 'Недоступно');
                return;
            }
            
            const hours = sliderToHours[sliderValue];
            const label = sliderToLabel[sliderValue];
            
            selectedHoursDisplay.textContent = label;
            
            // Calculate price based on selected option
            // postPrice теперь это цена за 12 часов (blogger_price)
            let calculatedPrice;
            if (hours === -1) {
                // Навсегда = используем цену блогера для постоянного размещения
                calculatedPrice = parseFloat(bloggerPermanentPrice) || (postPrice * 10);
            } else {
                // Пропорционально: (price_12h / 12) * hours
                calculatedPrice = (postPrice / 12) * hours;
            }
            
            calculatedPriceDisplay.textContent = `${calculatedPrice.toFixed(2)} ₽`;
            
            // Update slider background
            updateSliderBackground(this.value);
            
            // Haptic feedback on slider change
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.selectionChanged();
            }
        });
        
        // Восстанавливаем сохранённое значение длительности, если пользователь уже проходил этот шаг
        if (window.pendingPurchaseData && typeof window.pendingPurchaseData.durationHours === 'number') {
            const savedHours = window.pendingPurchaseData.durationHours;
            let sliderVal = 0;
            
            // Определяем ближайшее значение ползунка
            if (savedHours === -1) {
                sliderVal = hasPermanentPrice ? 3 : 2; // If no permanent price, default to 48h
            } else if (savedHours <= 12) {
                sliderVal = 0;
            } else if (savedHours <= 24) {
                sliderVal = 1;
            } else {
                sliderVal = 2;
            }
            
            slider.value = String(sliderVal);
            const hours = sliderToHours[sliderVal];
            const label = sliderToLabel[sliderVal];
            selectedHoursDisplay.textContent = label;
            
            let restoredPrice;
            if (hours === -1) {
                restoredPrice = parseFloat(bloggerPermanentPrice) || (postPrice * 10);
            } else {
                restoredPrice = (postPrice / 12) * hours;
            }
            calculatedPriceDisplay.textContent = `${restoredPrice.toFixed(2)} ₽`;
            updateSliderBackground(slider.value);
        }
    }
    
    // Восстанавливаем выбранную дату и время, если они уже были выбраны ранее
    const scheduleInputExisting = document.getElementById('post-schedule-time');
    const dayLabelExisting = document.getElementById('post-day-button-label');
    const timeLabelExisting = document.getElementById('post-day-button-time-label');
    if (scheduleInputExisting && window.pendingPurchaseData && window.pendingPurchaseData.scheduleTime) {
        scheduleInputExisting.value = window.pendingPurchaseData.scheduleTime;
        const restoredDate = new Date(window.pendingPurchaseData.scheduleTime);
        const info = getDayInfoFromDate(restoredDate);
        if (dayLabelExisting && info.full) {
            dayLabelExisting.textContent = info.full;
        }
        if (timeLabelExisting) {
            timeLabelExisting.textContent = window.pendingPurchaseData.scheduleTime.slice(11, 16);
        }
    }
    
    lucide.createIcons();
}

// Open hidden native datetime picker from the "Время" pill button
function openTimePickerFromButton() {
    const scheduleInput = document.getElementById('post-schedule-time');
    if (!scheduleInput) return;

    try {
        if (typeof scheduleInput.showPicker === 'function') {
            scheduleInput.showPicker();
        } else {
            scheduleInput.focus();
            scheduleInput.click();
        }
    } catch (e) {
        scheduleInput.focus();
        scheduleInput.click();
    }
}

// ==== Day picker modal for purchase ====

async function openDayPickerModal() {
    const overlay = document.getElementById('day-picker-modal-overlay');
    const calendar = document.getElementById('day-picker-week-calendar');
    const dayLabelEl = document.getElementById('day-picker-day-label');
    const timeDisplayEl = document.getElementById('day-picker-time-display');
    const timeSliderEl = document.getElementById('day-picker-time-slider');
    const timeContainer = document.getElementById('day-picker-time-container');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay || !calendar || !timeContainer || !timeSliderEl || !timeDisplayEl || !dayLabelEl) return;

    calendar.innerHTML = '';
    purchaseDayButtonsData = [];

    // Загружаем расписание выбранного блогера (если есть),
    // чтобы ограничить диапазон времени для каждого дня
    await loadCurrentBloggerSchedule();

    const baseDate = new Date();

    // Подготовим 7 дней начиная с сегодняшнего
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() + i);
        days.push({
            date: d,
            info: getDayInfoFromDate(d),
            index: i
        });
    }

    // Оставляем только те дни, которые блогер сделал активными в своём графике.
    // Сопоставляем по краткому названию дня недели (Пн, Вт и т.п.).
    // Дополнительно: если это сегодняшний день и всё допустимое время уже прошло,
    // то такой день не показываем в списке.
    let sourceDays = days.filter(d => {
        const short = d.info?.shortCode || d.info?.short;
        if (!short || !currentBloggerScheduleByDay[short]) {
            return false;
        }

        const bloggerDayLimits = currentBloggerScheduleByDay[short];
        if (!bloggerDayLimits || typeof timeToMinutes !== 'function') {
            return true;
        }

        const fromM = timeToMinutes(bloggerDayLimits.from);
        const toM = timeToMinutes(bloggerDayLimits.to);
        if (Number.isNaN(fromM) || Number.isNaN(toM) || toM <= fromM) {
            return true;
        }

        // Проверяем только для сегодняшнего дня: если текущее время больше максимального
        // разрешённого времени блогера, то день считаем недоступным.
        const baseYmd = formatLocalDateYMD(baseDate);
        const dayYmd = formatLocalDateYMD(d.date);
        if (baseYmd === dayYmd) {
            const nowMinutes = baseDate.getHours() * 60 + baseDate.getMinutes();
            if (nowMinutes > toM) {
                return false;
            }
        }

        return true;
    });

    // Если по какой-то причине активных дней в ближайшие 7 дней нет,
    // показываем все дни, чтобы не оставлять пользователя с пустым окном.
    if (sourceDays.length === 0) {
        sourceDays = days;
    }

    // Убеждаемся, что ранее выбранная дата (purchaseSelectedDate) всё ещё доступна.
    // Если её нет среди sourceDays (или она не была установлена), выбираем первый доступный день.
    if (purchaseSelectedDate) {
        const selectedYmd = formatLocalDateYMD(purchaseSelectedDate);
        const existsInSource = sourceDays.some(d => formatLocalDateYMD(d.date) === selectedYmd);
        if (!existsInSource) {
            purchaseSelectedDate = sourceDays[0]?.date ? new Date(sourceDays[0].date) : null;
        }
    } else {
        purchaseSelectedDate = sourceDays[0]?.date ? new Date(sourceDays[0].date) : null;
    }

    const createDayButton = (dayObj) => {
        const { date, info, index } = dayObj;
        const btn = document.createElement('button');
        btn.className = 'week-day-btn';
        btn.dataset.index = String(index);
        btn.dataset.date = formatLocalDateYMD(date);
        btn.dataset.fullDay = info.full;

        btn.innerHTML = `
            <div class="week-day-info">
                <div class="week-day-name">${info.short}</div>
                <div class="week-day-date">${info.displayDate}</div>
            </div>
        `;

        btn.addEventListener('click', () => {
            const alreadySelected = calendar.querySelector('.week-day-btn.selected');
            if (alreadySelected && alreadySelected !== btn) {
                alreadySelected.classList.remove('selected');
            }
            btn.classList.add('selected');
            purchaseSelectedDate = new Date(date);

            // Обновляем блок выбора времени под выбранный день
            updateDayPickerTimeSection(date, info);
        });

        // Подсветим уже выбранный день, если он попадает в диапазон 7 дней
        const current = purchaseSelectedDate;
        if (current) {
            const currentYmd = formatLocalDateYMD(current);
            const btnYmd = formatLocalDateYMD(date);
            if (currentYmd === btnYmd) {
                btn.classList.add('selected');
            }
        } else if (index === 0) {
            btn.classList.add('selected');
            purchaseSelectedDate = new Date(date);
        }

        purchaseDayButtonsData.push({ date, info });
        return btn;
    };

    // Первая строка — только первый доступный день по центру
    const firstRow = document.createElement('div');
    firstRow.className = 'week-calendar-row week-calendar-row-single';
    firstRow.appendChild(createDayButton(sourceDays[0]));
    calendar.appendChild(firstRow);

    // Остальные доступные дни — по два в строке
    const remaining = sourceDays.slice(1);
    for (let i = 0; i < remaining.length; i += 2) {
        const row = document.createElement('div');
        row.className = 'week-calendar-row';
        row.appendChild(createDayButton(remaining[i]));
        if (remaining[i + 1]) {
            row.appendChild(createDayButton(remaining[i + 1]));
        }
        calendar.appendChild(row);
    }

    // Инициализируем блок времени для изначально выбранного дня
    const initialDate = purchaseSelectedDate || sourceDays[0]?.date || new Date();
    const initialInfo = getDayInfoFromDate(initialDate);
    updateDayPickerTimeSection(initialDate, initialInfo);

    overlay.classList.add('active', 'day-picker-active');

    // Поднимаем блюр над модальными окнами, чтобы размывался в том числе purchase-modal
    if (blurOverlay) {
        blurOverlay.classList.add('active', 'above-modals');
    }

    setTimeout(() => {
        if (window.lucide) {
            lucide.createIcons();
        }
    }, 50);

    // Включаем маску ввода и обработчики для ручного ввода времени
    if (typeof attachTimeInputMask === 'function') {
        attachTimeInputMask(timeDisplayEl);
    }
    setupDayPickerTimeInput();

    // Готовим контейнер для текста ошибки под линией времени,
    // чтобы место под текст было зарезервировано и страница не «прыгала»
    if (timeContainer) {
        let errorEl = document.getElementById('day-picker-time-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.id = 'day-picker-time-error';
            errorEl.className = 'time-slot-error-message';
            errorEl.textContent = '';
            timeContainer.appendChild(errorEl);
        }
    }
}

function closeDayPickerModal() {
    const overlay = document.getElementById('day-picker-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;
    overlay.classList.remove('active', 'day-picker-active');

    // Возвращаем блюр под модальные окна (если purchase-modal ещё открыт, он продолжит использовать обычный blur с z-index 999)
    if (blurOverlay) {
        blurOverlay.classList.remove('above-modals');
    }
}

// Обновление блока выбора времени (полоса) для выбранного дня
function updateDayPickerTimeSection(date, info) {
    const dayLabelEl = document.getElementById('day-picker-day-label');
    const timeDisplayEl = document.getElementById('day-picker-time-display');
    const timeSliderEl = document.getElementById('day-picker-time-slider');
    const rangeEl = document.getElementById('day-picker-slider-range');
    const timeContainer = document.getElementById('day-picker-time-container');
    const scheduleInput = document.getElementById('post-schedule-time');

    if (!dayLabelEl || !timeDisplayEl || !timeSliderEl || !rangeEl || !timeContainer) {
        return;
    }

    // Подпись дня над линией (используем локализованное полное название, при fallback — короткое)
    dayLabelEl.textContent = info.full || info.short || '';

    // Берём текущее время публикации из скрытого инпута, если оно есть
    let currentMinutes = null;
    if (scheduleInput && scheduleInput.value) {
        const timePart = scheduleInput.value.slice(11, 16); // HH:MM
        if (typeof timeToMinutes === 'function') {
            currentMinutes = timeToMinutes(timePart);
        } else {
            const [h, m] = timePart.split(':').map(Number);
            currentMinutes = (h || 0) * 60 + (m || 0);
        }
    }

    // Если время ещё не выбрано, используем текущее локальное время
    if (currentMinutes === null || Number.isNaN(currentMinutes)) {
        const now = new Date();
        currentMinutes = now.getHours() * 60 + now.getMinutes();
    }

    // Определяем базовые ограничения по времени для данного дня из расписания блогера
    let minMinutes = 0;
    let maxMinutes = 1439;

    const short = info.short;
    const bloggerDayLimits = short ? currentBloggerScheduleByDay[short] : null;
    if (bloggerDayLimits && typeof timeToMinutes === 'function') {
        const fromM = timeToMinutes(bloggerDayLimits.from);
        const toM = timeToMinutes(bloggerDayLimits.to);
        if (!Number.isNaN(fromM) && !Number.isNaN(toM) && toM > fromM) {
            minMinutes = fromM;
            maxMinutes = toM;
        }
    }

    // Для сегодняшнего дня делаем минимальное время не раньше текущего момента:
    // effectiveMin = max(лимит блогера "from", текущее время).
    let effectiveMin = minMinutes;
    const todayYmd = formatLocalDateYMD(new Date());
    const dayYmd = formatLocalDateYMD(date);
    if (todayYmd === dayYmd) {
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (!Number.isNaN(nowMinutes) && nowMinutes > effectiveMin && nowMinutes < maxMinutes) {
            effectiveMin = nowMinutes;
        }
    }

    timeSliderEl.min = String(effectiveMin);
    timeSliderEl.max = String(maxMinutes);

    // Клэмпим выбранное время в допустимый диапазон
    const clamped = Math.min(maxMinutes, Math.max(effectiveMin, currentMinutes));
    timeSliderEl.value = String(clamped);
    purchaseSelectedTimeMinutes = clamped;

    // Обновляем отображение времени над линией
    if (typeof minutesToTime === 'function') {
        timeDisplayEl.value = minutesToTime(clamped);
    } else {
        const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
        const mins = String(clamped % 60).padStart(2, '0');
        timeDisplayEl.value = `${hours}:${mins}`;
    }

    // Обновляем отображение лимитов по краям ползунка
    const minLabelEl = document.getElementById('day-picker-time-min-label');
    const maxLabelEl = document.getElementById('day-picker-time-max-label');
    if (minLabelEl && maxLabelEl) {
        if (typeof minutesToTime === 'function') {
            // Слева показываем фактический минимум (для сегодняшнего дня это может быть текущее время),
            // справа — максимальное время блогера.
            minLabelEl.textContent = minutesToTime(effectiveMin);
            maxLabelEl.textContent = minutesToTime(maxMinutes);
        } else {
            const minH = String(Math.floor(effectiveMin / 60)).padStart(2, '0');
            const minMin = String(effectiveMin % 60).padStart(2, '0');
            const maxH = String(Math.floor(maxMinutes / 60)).padStart(2, '0');
            const maxMin = String(maxMinutes % 60).padStart(2, '0');
            minLabelEl.textContent = `${minH}:${minMin}`;
            maxLabelEl.textContent = `${maxH}:${maxMin}`;
        }
    }

    // Обновляем заполненную часть полосы
    updateDayPickerSliderRange();

    // Показываем контейнер, если он был скрыт
    timeContainer.style.display = 'block';
    requestAnimationFrame(() => {
        timeContainer.classList.add('active');
    });
}

// Обновление заливки линии времени в модалке выбора дня
function updateDayPickerSliderRange() {
    const timeSliderEl = document.getElementById('day-picker-time-slider');
    const rangeEl = document.getElementById('day-picker-slider-range');
    if (!timeSliderEl || !rangeEl) return;

    const min = parseInt(timeSliderEl.min, 10);
    const max = parseInt(timeSliderEl.max, 10);
    const value = parseInt(timeSliderEl.value, 10);

    if (Number.isNaN(min) || Number.isNaN(max) || Number.isNaN(value) || max <= min) {
        rangeEl.style.left = '0%';
        rangeEl.style.width = '0%';
        return;
    }

    const percent = ((value - min) / (max - min)) * 100;
    rangeEl.style.left = '0%';
    rangeEl.style.width = `${percent}%`;
}

// Настройка обработчиков для слайдера и ручного ввода времени в модалке выбора дня
function setupDayPickerTimeInput() {
    const timeDisplayEl = document.getElementById('day-picker-time-display');
    const timeSliderEl = document.getElementById('day-picker-time-slider');
    if (!timeDisplayEl || !timeSliderEl) return;

    // Удаляем старые листенеры путём клонирования
    const newSliderEl = timeSliderEl.cloneNode(true);
    timeSliderEl.parentNode.replaceChild(newSliderEl, timeSliderEl);
    const slider = document.getElementById('day-picker-time-slider');

    // Helper: сброс визуальных ошибок времени
    const clearTimeSlotError = () => {
        const container = document.getElementById('day-picker-time-container');
        const errorId = 'day-picker-time-error';
        const existingError = document.getElementById(errorId);
        if (container) {
            container.classList.remove('time-slot-error');
        }
        if (existingError) {
            // Очищаем текст, но не удаляем элемент, чтобы не было «прыжка» высоты
            existingError.textContent = '';
        }
    };

    // Helper: показать ошибку занятости времени
    const showTimeSlotError = (message) => {
        const container = document.getElementById('day-picker-time-container');
        if (!container) return;

        container.classList.add('time-slot-error');

        const errorId = 'day-picker-time-error';
        let errorEl = document.getElementById(errorId);
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.id = errorId;
            errorEl.className = 'time-slot-error-message';
            container.appendChild(errorEl);
        }
        errorEl.textContent = message || 'Это время занято, выберите другое время';
    };

    // Helper: проверка слота на бэкенде
    const checkTimeSlotAvailability = async () => {
        try {
            clearTimeSlotError();

            const bloggerId = window.currentBloggerUserId;
            const scheduleInput = document.getElementById('post-schedule-time');
            if (!bloggerId || !scheduleInput || !scheduleInput.value) {
                return;
            }

            const scheduledTime = scheduleInput.value; // формат YYYY-MM-DDTHH:MM

            const response = await authenticatedFetch(
                `/api/ad_posts/check_slot?blogger_id=${encodeURIComponent(
                    bloggerId
                )}&scheduled_time=${encodeURIComponent(scheduledTime)}`
            );

            const data = await response.json();
            if (response.ok && data && data.available === false) {
                showTimeSlotError(data.message || 'Это время занято, выберите другое время');
                if (window.Telegram?.WebApp?.HapticFeedback) {
                    window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
                }
            } else {
                clearTimeSlotError();
            }
        } catch (e) {
            console.error('Error checking time slot availability:', e);
        }
    };

    // Обновление по движению слайдера
    const onSliderInput = () => {
        const value = parseInt(slider.value, 10);
        if (Number.isNaN(value)) return;

        purchaseSelectedTimeMinutes = value;

        if (typeof minutesToTime === 'function') {
            timeDisplayEl.value = minutesToTime(value);
        } else {
            const hours = String(Math.floor(value / 60)).padStart(2, '0');
            const mins = String(value % 60).padStart(2, '0');
            timeDisplayEl.value = `${hours}:${mins}`;
        }

        updateDayPickerSliderRange();

        // Обновляем скрытый инпут с датой/временем под текущее значение слайдера,
        // чтобы на бэкенд улетало именно выбранное время
        const scheduleInput = document.getElementById('post-schedule-time');
        if (scheduleInput && purchaseSelectedDate) {
            const localDate = new Date(purchaseSelectedDate);
            const ymd = formatLocalDateYMD(localDate);
            const h = String(Math.floor(value / 60)).padStart(2, '0');
            const m = String(value % 60).padStart(2, '0');
            scheduleInput.value = `${ymd}T${h}:${m}`;
        }

        // Проверяем слот на занятость (без жёсткого блока по сети, просто подсветка)
        checkTimeSlotAvailability();

        // Лёгкий хаптик
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.selectionChanged();
        }
    };

    slider.addEventListener('input', onSliderInput);

    // Ручной ввод времени
    const applyManualTime = () => {
        let value = (timeDisplayEl.value || '').trim();
        if (!value) return;

        // Приводим к формату HH:MM
        value = value.replace(/\D/g, '').slice(0, 4);
        if (value.length < 3) return;
        const hours = parseInt(value.slice(0, 2), 10);
        const mins = parseInt(value.slice(2, 4), 10);
        if (Number.isNaN(hours) || Number.isNaN(mins)) return;

        let minutesTotal = hours * 60 + mins;

        const min = parseInt(slider.min, 10);
        const max = parseInt(slider.max, 10);
        if (!Number.isNaN(min) && !Number.isNaN(max)) {
            minutesTotal = Math.min(max, Math.max(min, minutesTotal));
        }

        slider.value = String(minutesTotal);
        purchaseSelectedTimeMinutes = minutesTotal;

        if (typeof minutesToTime === 'function') {
            timeDisplayEl.value = minutesToTime(minutesTotal);
        } else {
            const h = String(Math.floor(minutesTotal / 60)).padStart(2, '0');
            const m = String(minutesTotal % 60).padStart(2, '0');
            timeDisplayEl.value = `${h}:${m}`;
        }

        updateDayPickerSliderRange();
        // Синхронизируем скрытое поле и запускаем проверку занятости
        const scheduleInput = document.getElementById('post-schedule-time');
        if (scheduleInput && purchaseSelectedDate) {
            const localDate = new Date(purchaseSelectedDate);
            const ymd = formatLocalDateYMD(localDate);
            const h = String(Math.floor(minutesTotal / 60)).padStart(2, '0');
            const m = String(minutesTotal % 60).padStart(2, '0');
            scheduleInput.value = `${ymd}T${h}:${m}`;
        }

        checkTimeSlotAvailability();
    };

    timeDisplayEl.addEventListener('blur', applyManualTime);
    timeDisplayEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyManualTime();
            timeDisplayEl.blur();
        }
    });
}

function saveSelectedDayForPurchase() {
    const scheduleInput = document.getElementById('post-schedule-time');
    const dayLabelEl = document.getElementById('post-day-button-label');
    const timeLabelEl = document.getElementById('post-day-button-time-label');
    const timeContainer = document.getElementById('day-picker-time-container');
    const timeErrorEl = document.getElementById('day-picker-time-error');

    if (!scheduleInput) {
        closeDayPickerModal();
        return;
    }

    // Если есть активная ошибка по занятости слота – не даём сохранить
    if (timeContainer && timeContainer.classList.contains('time-slot-error')) {
        const msg = timeErrorEl?.textContent || 'Это время занято, выберите другое время';
        showNotification(msg, 'error');
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }
        return;
    }

    // Если почему-то дата не выбрана – используем сегодня
    if (!purchaseSelectedDate) {
        purchaseSelectedDate = new Date();
    }

    // Время берём из выбранного значения на полосе (если есть), иначе из скрытого инпута
    let timeMinutes = purchaseSelectedTimeMinutes;
    if (timeMinutes === null || Number.isNaN(timeMinutes)) {
        if (scheduleInput.value) {
            const existingTime = scheduleInput.value.slice(11, 16);
            if (typeof timeToMinutes === 'function') {
                timeMinutes = timeToMinutes(existingTime);
            } else {
                const [h, m] = existingTime.split(':').map(Number);
                timeMinutes = (h || 0) * 60 + (m || 0);
            }
        } else {
            const now = new Date();
            timeMinutes = now.getHours() * 60 + now.getMinutes();
        }
    }

    const hours = String(Math.floor(timeMinutes / 60)).padStart(2, '0');
    const mins = String(timeMinutes % 60).padStart(2, '0');
    const timePart = `${hours}:${mins}`;

    const localDate = new Date(purchaseSelectedDate);
    const ymd = formatLocalDateYMD(localDate);
    scheduleInput.value = `${ymd}T${timePart}`;

    const info = getDayInfoFromDate(localDate);
    if (dayLabelEl && info.full) {
        dayLabelEl.textContent = info.full;
    }

    if (timeLabelEl) {
        timeLabelEl.textContent = timePart;
    }

    // Закрываем модал выбора дня и возвращаем блюр в исходное состояние
    closeDayPickerModal();

    // Лёгкий хаптик
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Close purchase modal
function closePurchaseModal() {
    const modalOverlay = document.getElementById('purchase-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// Topup and return to purchase
function topupAndReturn() {
    closePurchaseModal();
    setTimeout(() => {
        openBalanceTopupModal();
    }, 300);
}

// Confirm purchase (step 1 -> step 2: открываем модал оформления поста)
function confirmPurchase() {
    const durationSlider = document.getElementById('post-duration-slider');
    const sliderValue = durationSlider?.value;
    const scheduleTime = document.getElementById('post-schedule-time')?.value;
    
    if (sliderValue === undefined || sliderValue === null) {
        showNotification('Выберите время размещения', 'warning');
        return;
    }
    
    if (!scheduleTime) {
        showNotification('Выберите дату и время публикации', 'warning');
        return;
    }
    
    // Map slider values to actual hours: 0->12, 1->24, 2->48, 3->permanent (-1)
    const sliderToHours = {
        0: 12,
        1: 24,
        2: 48,
        3: -1  // -1 означает "навсегда"
    };
    
    const durationHours = sliderToHours[parseInt(sliderValue, 10)];
    
    // Получаем базовую цену за 12 часов (теперь это базовая единица)
    const postPrice = window.currentPurchaseContext?.postPrice || 0;
    if (postPrice <= 0) {
        showNotification('Ошибка: не удалось определить стоимость', 'error');
        return;
    }
    
    // Вычисляем финальную цену на основе выбранного времени
    let finalPrice;
    if (durationHours === -1) {
        // Навсегда = цена * 10
        finalPrice = postPrice * 10;
    } else {
        // Пропорционально: (price_12h / 12) * hours
        finalPrice = (postPrice / 12) * durationHours;
    }
    
    // Сохраняем промежуточные данные о покупке для второго шага
    window.pendingPurchaseData = {
        durationHours: durationHours,
        scheduleTime: scheduleTime,
        estimatedPrice: finalPrice,  // Только для отображения пользователю
        isOffer: !!window.currentPurchaseContext?.isOffer,
        offerBasePrice: window.currentPurchaseContext?.offerBasePrice || null
    };
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    // Закрываем модал выбора времени и открываем модал оформления поста
    closePurchaseModal();
    setTimeout(() => {
        openPostCreationModal();
    }, 260);
}

// ===== Модал оформления поста (шаг 2 покупки) =====

function openPostCreationModal() {
    const overlay = document.getElementById('post-creation-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;
    
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    if (blurOverlay) {
        blurOverlay.classList.add('active');
    }
    
    // Инициализируем обработчик ввода текста
    const textarea = document.getElementById('post-creation-text');
    if (textarea) {
        // Удаляем старые обработчики
        textarea.removeEventListener('input', validatePostText);
        // Добавляем новый обработчик
        textarea.addEventListener('input', validatePostText);
        
        // Если есть данные премиум-поста, заполняем текст
        if (window.premiumPostForSubmit && window.premiumPostForSubmit.post_text) {
            textarea.value = window.premiumPostForSubmit.post_text;
        } else {
            // Сбрасываем значение только если нет премиум-поста
            textarea.value = '';
        }
        validatePostText();
    }
    
    // Сбрасываем фотографии (пока не обрабатываем изображения из премиум-поста)
    window.postCreationImages = [];
    const imagesGrid = document.getElementById('post-creation-images-grid');
    const placeholder = document.getElementById('post-creation-placeholder');
    if (imagesGrid && placeholder) {
        imagesGrid.innerHTML = '';
        imagesGrid.classList.remove('has-images');
        imagesGrid.classList.remove('single-image');
        placeholder.style.display = 'flex';
    }
    
    // Обновляем иконки
    setTimeout(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, 50);
    
    // Лёгкий хаптик
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

function closePostCreationModal(keepBlur = false) {
    const overlay = document.getElementById('post-creation-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;
    
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    
    if (blurOverlay && !keepBlur) {
        blurOverlay.classList.remove('active');
    }
    
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Кнопка "Назад" из шага оформления поста к выбору времени
function backToTimeSelection() {
    // Лёгкий хаптик
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    closePostCreationModal(true);
    setTimeout(() => {
        openPurchaseModal();
    }, 260);
}

// Триггер выбора изображений
function triggerPostImagesUpload() {
    const input = document.getElementById('post-creation-file-input');
    if (input) {
        input.click();
    }
}

// Обработка выбранных изображений для поста
function handlePostImagesSelected(event) {
    const files = Array.from(event.target.files || []);
    const imagesGrid = document.getElementById('post-creation-images-grid');
    const placeholder = document.getElementById('post-creation-placeholder');
    const note = document.getElementById('post-creation-images-note');
    
    if (!imagesGrid || !placeholder || !note) return;
    
    if (!files.length) {
        imagesGrid.innerHTML = '';
        imagesGrid.classList.remove('has-images');
        imagesGrid.classList.remove('single-image');
        note.style.display = 'none';
        placeholder.style.display = 'flex';
        window.postCreationImages = [];
        validatePostText(); // Проверяем текст при удалении фото
        return;
    }
    
    // Сохраняем все файлы, но в предпросмотр выводим максимум 5
    window.postCreationImages = files;
    
    const previewFiles = files.slice(0, 5);
    const extraCount = files.length > 5 ? files.length - 5 : 0;
    
    imagesGrid.innerHTML = '';
    
    // Если только 1 фото - добавляем специальный класс
    if (files.length === 1) {
        imagesGrid.classList.add('single-image');
    } else {
        imagesGrid.classList.remove('single-image');
    }
    
    previewFiles.forEach((file, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'post-creation-image-thumb';
        
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        
        thumb.appendChild(img);
        
        // Если есть дополнительные фото сверх 5, показываем индикатор на последнем превью
        if (index === previewFiles.length - 1 && extraCount > 0) {
            thumb.classList.add('more-indicator');
            thumb.setAttribute('data-more', `+${extraCount}`);
        }
        
        imagesGrid.appendChild(thumb);
    });
    
    imagesGrid.classList.add('has-images');
    placeholder.style.display = 'none';
    
    if (extraCount > 0) {
        note.textContent = `Будет создан коллаж: ${files.length} фото, в ленте отобразятся как единый пост.`;
        note.style.display = 'block';
    } else {
        note.style.display = 'none';
    }
    
    // Проверяем текст при добавлении фото
    validatePostText();
}

// Валидация текста поста с учётом наличия медиа
function validatePostText() {
    const textarea = document.getElementById('post-creation-text');
    const wrapper = document.getElementById('post-creation-text-wrapper');
    const counter = document.getElementById('post-creation-char-counter');
    const errorMsg = document.getElementById('post-creation-text-error');
    
    if (!textarea || !wrapper || !counter) return true;
    
    const text = textarea.value || '';
    const textLength = text.length;
    const hasMedia = window.postCreationImages && window.postCreationImages.length > 0;
    
    // Определяем лимит: 950 с медиа, 4000 без
    const maxLimit = hasMedia ? 950 : 4000;
    
    // Обновляем maxlength у textarea
    textarea.setAttribute('maxlength', maxLimit);
    
    // Обновляем счётчик
    const isError = textLength > maxLimit;
    counter.textContent = `${textLength} / ${maxLimit}`;
    
    if (isError) {
        wrapper.classList.add('error');
        counter.classList.add('error');
        if (errorMsg && hasMedia) {
            const lang = localStorage.getItem('app_language') || 'ru';
            const dict = UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.ru;
            const tpl =
                (dict && dict.post_creation_error_with_media) ||
                'Максимальное количество символов с фото: {limit}';
            errorMsg.textContent = tpl.replace('{limit}', String(maxLimit));
        }
        return false;
    } else {
        wrapper.classList.remove('error');
        counter.classList.remove('error');
        return true;
    }
}

// Обработчик клика по кнопке премиум-эмодзи
function handlePremiumEmojiClick() {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    // Закрываем модальное окно оформления поста БЕЗ сохранения blur
    closePostCreationModal(false); // keepBlur = false
    
    // Открываем модальное окно для премиум-эмодзи
    openPremiumEmojiModal();
}

// Открыть модальное окно для премиум-эмодзи
function openPremiumEmojiModal() {
    const overlay = document.getElementById('premium-emoji-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    
    if (!overlay) return;
    
    // Генерируем уникальный session_id
    const sessionId = `premium_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    window.premiumPostSessionId = sessionId;
    window.premiumPostReceived = false;
    
    // Отправляем запрос боту для начала сессии
    startPremiumPostSession(sessionId);
    
    // Показываем модальное окно
    overlay.classList.add('active');
    if (blurOverlay) {
        blurOverlay.classList.add('active');
        // Убираем класс above-modals если он есть
        blurOverlay.classList.remove('above-modals');
    }
    
    // Обновляем иконки Lucide
    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    // Запускаем проверку статуса поста каждые 2 секунды
    if (window.premiumPostCheckInterval) {
        clearInterval(window.premiumPostCheckInterval);
    }
    window.premiumPostCheckInterval = setInterval(checkPremiumPostStatus, 2000);
}

// Закрыть модальное окно для премиум-эмодзи
function closePremiumEmojiModal() {
    const overlay = document.getElementById('premium-emoji-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    
    if (!overlay) return;
    
    overlay.classList.remove('active');
    if (blurOverlay) {
        blurOverlay.classList.remove('active');
    }
    
    // Останавливаем проверку статуса
    if (window.premiumPostCheckInterval) {
        clearInterval(window.premiumPostCheckInterval);
        window.premiumPostCheckInterval = null;
    }
    
    // Очищаем данные сессии
    window.premiumPostSessionId = null;
    window.premiumPostReceived = false;
    
    // Возвращаемся к модальному окну оформления поста
    openPostCreationModal();
}

// Начать сессию создания поста с премиум-эмодзи
async function startPremiumPostSession(sessionId) {
    console.log('🚀 Starting premium post session:', sessionId);
    try {
        const response = await authenticatedFetch('/api/premium_post/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ session_id: sessionId })
        });
        
        console.log('📡 Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Failed to start session:', errorText);
            throw new Error('Failed to start premium post session');
        }
        
        const data = await response.json();
        console.log('✅ Premium post session started:', data);
        
    } catch (error) {
        console.error('❌ Error starting premium post session:', error);
        showNotification('Ошибка при запуске сессии', 'error');
    }
}

// Проверить статус поста с премиум-эмодзи
async function checkPremiumPostStatus() {
    if (!window.premiumPostSessionId) return;
    
    try {
        const response = await authenticatedFetch(`/api/premium_post/status?session_id=${window.premiumPostSessionId}`);
        
        if (!response.ok) {
            return;
        }
        
        const data = await response.json();
        
        if (data.status === 'received') {
            // Пост получен от бота
            window.premiumPostReceived = true;
            window.premiumPostData = data;
            
            // Активируем кнопку "Продолжить"
            const continueBtn = document.getElementById('premium-continue-btn');
            if (continueBtn) {
                continueBtn.disabled = false;
                continueBtn.style.opacity = '1';
                continueBtn.style.pointerEvents = 'auto';
            }
            
            // Останавливаем проверку
            if (window.premiumPostCheckInterval) {
                clearInterval(window.premiumPostCheckInterval);
                window.premiumPostCheckInterval = null;
            }
            
            showNotification('Пост получен! Нажмите "Продолжить"', 'success');
        }
        
    } catch (error) {
        console.error('Error checking premium post status:', error);
    }
}

// Продолжить с полученным постом
async function continuePremiumPost() {
    if (!window.premiumPostReceived || !window.premiumPostData) {
        showNotification('Сначала отправьте пост боту', 'warning');
        return;
    }
    
    // Проверяем, что есть данные о покупке (время, продолжительность)
    if (!window.pendingPurchaseData || !window.pendingPurchaseData.scheduleTime) {
        showNotification('Ошибка: данные о времени публикации не найдены', 'error');
        return;
    }
    
    if (!window.currentBloggerData) {
        showNotification('Ошибка: данные блогера не найдены', 'error');
        return;
    }
    
    // Закрываем модальное окно премиум-эмодзи
    const overlay = document.getElementById('premium-emoji-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
    
    // Показываем индикатор загрузки
    showNotification('Отправка поста...', 'info');
    
    try {
        // Получаем данные из pendingPurchaseData
        const purchaseData = window.pendingPurchaseData;
        const postText = window.premiumPostData.post_text || '';
        
        // Формируем данные для отправки
        const formData = new FormData();
        formData.append('blogger_id', window.currentBloggerUserId);
        
        // Добавляем channel_id если он есть
        if (window.currentBloggerData?.channel_id) {
            formData.append('channel_id', window.currentBloggerData.channel_id);
        }
        
        formData.append('post_text', postText);
        formData.append('scheduled_time', purchaseData.scheduleTime);
        formData.append('duration_hours', purchaseData.durationHours);
        
        // Если покупка идёт по офферу — передаём это на сервер
        if (purchaseData?.isOffer) {
            formData.append('is_offer', '1');
            if (purchaseData.offerBasePrice) {
                formData.append('offer_base_price', purchaseData.offerBasePrice);
            }
        }
        
        // Добавляем данные о премиум-посте
        formData.append('is_premium_post', '1');
        formData.append('premium_message_id', window.premiumPostData.telegram_message_id);
        formData.append('premium_chat_id', window.premiumPostData.telegram_chat_id);
        console.log('📤 Sending premium post data:', {
            message_id: window.premiumPostData.telegram_message_id,
            chat_id: window.premiumPostData.telegram_chat_id,
            text_length: postText.length
        });
        
        // Отправляем запрос
        const response = await authenticatedFetch('/api/ad_posts/create', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при создании поста');
        }
        
        const result = await response.json();
        
        // Закрываем модалку покупки если открыта
        closePurchaseModal();
        
        // Показываем успешное уведомление
        showNotification('Пост отправлен блогеру на модерацию!', 'success');
        
        // Обновляем баланс пользователя
        await loadUserProfile();
        
        // Очищаем данные
        window.pendingPurchaseData = null;
        window.premiumPostReceived = false;
        window.premiumPostData = null;
        
    } catch (error) {
        console.error('Error submitting premium post:', error);
        showNotification(error.message || 'Ошибка при отправке поста', 'error');
    }
}


// Финальный сабмит покупки с текстом и фото (пока заглушка)
function submitPostPurchase() {
    const text = document.getElementById('post-creation-text')?.value?.trim() || '';
    
    // Проверяем валидность текста
    if (!validatePostText()) {
        showNotification('Превышен лимит символов', 'error');
        return;
    }
    
    if (!text) {
        showNotification('Пожалуйста, напишите текст поста', 'warning');
        return;
    }
    
    if (!window.pendingPurchaseData || !window.pendingPurchaseData.scheduleTime) {
        showNotification('Сначала выберите время и дату публикации', 'warning');
        return;
    }
    
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    // Отправка данных на сервер
    submitAdPostToServer(text);
}

// Отправка рекламного поста на сервер
async function submitAdPostToServer(postText) {
    try {
        // Показываем индикатор загрузки
        showNotification('Отправка поста...', 'info');
        
        // Получаем данные из pendingPurchaseData
        const purchaseData = window.pendingPurchaseData;
        const images = window.postCreationImages || [];
        
        // Формируем данные для отправки
        const formData = new FormData();
        formData.append('blogger_id', window.currentBloggerUserId);
        
        // Добавляем channel_id если он есть
        if (window.currentBloggerData?.channel_id) {
            formData.append('channel_id', window.currentBloggerData.channel_id);
        }
        
        formData.append('post_text', postText);
        formData.append('scheduled_time', purchaseData.scheduleTime);
        formData.append('duration_hours', purchaseData.durationHours); // Отправляем только продолжительность
        
        // Если покупка идёт по офферу — передаём это на сервер
        if (purchaseData?.isOffer) {
            formData.append('is_offer', '1');
            if (purchaseData.offerBasePrice) {
                formData.append('offer_base_price', purchaseData.offerBasePrice);
            }
        }
        
        // Добавляем данные о премиум-посте если есть
        if (window.premiumPostForSubmit && window.premiumPostForSubmit.is_premium) {
            formData.append('is_premium_post', '1');
            formData.append('premium_message_id', window.premiumPostForSubmit.telegram_message_id);
            formData.append('premium_chat_id', window.premiumPostForSubmit.telegram_chat_id);
            console.log('📤 Sending premium post data:', window.premiumPostForSubmit);
        }
        
        // Добавляем изображения
        images.forEach((file, index) => {
            formData.append(`image_${index}`, file);
        });
        
        // Отправляем запрос
        const response = await authenticatedFetch('/api/ad_posts/create', {
            method: 'POST',
            body: formData
            // НЕ указываем Content-Type, браузер сам установит multipart/form-data с boundary
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при создании поста');
        }
        
        const result = await response.json();
        
        // Закрываем модалку создания поста
        closePostCreationModal();
        closePurchaseModal();
        
        // Показываем успешное уведомление
        showNotification('Пост отправлен блогеру на модерацию!', 'success');
        
        // Обновляем баланс пользователя
        await loadUserProfile();
        
        // Очищаем данные
        window.pendingPurchaseData = null;
        window.postCreationImages = [];
        window.premiumPostForSubmit = null; // Очищаем данные премиум-поста
        
    } catch (error) {
        console.error('Error submitting ad post:', error);
        showNotification(error.message || 'Ошибка при отправке поста', 'error');
    }
}

// ===== Флоу создания предложения поста на странице Offer (2 шага) =====

// Глобальное состояние черновика предложения
window.currentOfferDraft = {
    images: [],
    text: '',
    hourPrice: null,
    topic: null,
    durationHours: 1
};

// Открыть шаг 1 (контент)
function openOfferPostModal() {
    const overlay = document.getElementById('offer-post-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    // Сброс/восстановление черновика
    const textarea = document.getElementById('offer-post-text');
    const counter = document.getElementById('offer-post-char-counter');
    const wrapper = document.getElementById('offer-post-text-wrapper');
    const errorMsg = document.getElementById('offer-post-text-error');

    if (textarea && counter && wrapper) {
        textarea.value = window.currentOfferDraft.text || '';
        wrapper.classList.remove('error');
        counter.classList.remove('error');
        const textLength = textarea.value.length;
        counter.textContent = `${textLength} / 4000`;
        if (errorMsg) {
            errorMsg.style.display = 'none';
        }
    }

    // Рендер фото, если уже есть
    const imagesGrid = document.getElementById('offer-post-images-grid');
    const placeholder = document.getElementById('offer-post-placeholder');
    const note = document.getElementById('offer-post-images-note');
    if (imagesGrid && placeholder && note) {
        imagesGrid.innerHTML = '';
        imagesGrid.classList.remove('has-images');
        imagesGrid.classList.remove('single-image');
        note.style.display = 'none';
        placeholder.style.display = 'flex';

        const files = window.currentOfferDraft.images || [];
        if (files.length) {
            const previewFiles = files.slice(0, 5);
            const extraCount = files.length > 5 ? files.length - 5 : 0;

            if (files.length === 1) {
                imagesGrid.classList.add('single-image');
            }

            previewFiles.forEach((file, index) => {
                const thumb = document.createElement('div');
                thumb.className = 'post-creation-image-thumb';

                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                img.onload = () => URL.revokeObjectURL(img.src);

                thumb.appendChild(img);

                if (index === previewFiles.length - 1 && extraCount > 0) {
                    thumb.classList.add('more-indicator');
                    thumb.setAttribute('data-more', `+${extraCount}`);
                }

                imagesGrid.appendChild(thumb);
            });

            imagesGrid.classList.add('has-images');
            placeholder.style.display = 'none';

            if (extraCount > 0) {
                note.textContent = `Будет создан коллаж: ${files.length} фото, в ленте отобразятся как единый пост.`;
                note.style.display = 'block';
            }
        }
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (blurOverlay) {
        blurOverlay.classList.add('active');
    }

    // Обновляем иконки
    setTimeout(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, 50);

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

function closeOfferPostModal(keepBlur = false) {
    const overlay = document.getElementById('offer-post-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    document.body.style.overflow = '';

    if (blurOverlay && !keepBlur) {
        blurOverlay.classList.remove('active');
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Выбор изображений для предложения
function triggerOfferImagesUpload() {
    const input = document.getElementById('offer-post-file-input');
    if (input) {
        input.click();
    }
}

function handleOfferImagesSelected(event) {
    const files = Array.from(event.target.files || []);
    const imagesGrid = document.getElementById('offer-post-images-grid');
    const placeholder = document.getElementById('offer-post-placeholder');
    const note = document.getElementById('offer-post-images-note');

    if (!imagesGrid || !placeholder || !note) return;

    if (!files.length) {
        imagesGrid.innerHTML = '';
        imagesGrid.classList.remove('has-images');
        imagesGrid.classList.remove('single-image');
        note.style.display = 'none';
        placeholder.style.display = 'flex';
        window.currentOfferDraft.images = [];
        validateOfferPostText();
        return;
    }

    window.currentOfferDraft.images = files;

    const previewFiles = files.slice(0, 5);
    const extraCount = files.length > 5 ? files.length - 5 : 0;

    imagesGrid.innerHTML = '';

    if (files.length === 1) {
        imagesGrid.classList.add('single-image');
    } else {
        imagesGrid.classList.remove('single-image');
    }

    previewFiles.forEach((file, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'post-creation-image-thumb';

        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);

        thumb.appendChild(img);

        if (index === previewFiles.length - 1 && extraCount > 0) {
            thumb.classList.add('more-indicator');
            thumb.setAttribute('data-more', `+${extraCount}`);
        }

        imagesGrid.appendChild(thumb);
    });

    imagesGrid.classList.add('has-images');
    placeholder.style.display = 'none';

    if (extraCount > 0) {
        note.textContent = `Будет создан коллаж: ${files.length} фото, в ленте отобразятся как единый пост.`;
        note.style.display = 'block';
    } else {
        note.style.display = 'none';
    }

    validateOfferPostText();
}

function validateOfferPostText() {
    const textarea = document.getElementById('offer-post-text');
    const wrapper = document.getElementById('offer-post-text-wrapper');
    const counter = document.getElementById('offer-post-char-counter');
    const errorMsg = document.getElementById('offer-post-text-error');

    if (!textarea || !wrapper || !counter) return true;

    const text = textarea.value || '';
    const textLength = text.length;
    const hasMedia = window.currentOfferDraft.images && window.currentOfferDraft.images.length > 0;

    const maxLimit = hasMedia ? 950 : 4000;
    textarea.setAttribute('maxlength', maxLimit);

    const isError = textLength > maxLimit;
    counter.textContent = `${textLength} / ${maxLimit}`;

    if (isError) {
        wrapper.classList.add('error');
        counter.classList.add('error');
        if (errorMsg && hasMedia) {
            errorMsg.style.display = 'block';
        }
        return false;
    } else {
        wrapper.classList.remove('error');
        counter.classList.remove('error');
        if (errorMsg) {
            errorMsg.style.display = 'none';
        }
        return true;
    }
}

// Переход со шага 1 (контент) на шаг 2 (настройки)
function continueOfferToSettings() {
    const textarea = document.getElementById('offer-post-text');
    if (textarea) {
        window.currentOfferDraft.text = textarea.value.trim();
    }

    if (!window.currentOfferDraft.text) {
        showNotification('Опишите вашу идею поста', 'warning');
        return;
    }

    if (!validateOfferPostText()) {
        showNotification('Превышен лимит символов', 'error');
        return;
    }

    closeOfferPostModal(true);
    setTimeout(() => {
        openOfferSettingsModal();
    }, 260);
}

// Шаг 2: настройки (цена, тематика, срок)
function openOfferSettingsModal() {
    const overlay = document.getElementById('offer-settings-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    // Инициализация полей
    const priceInput = document.getElementById('offer-hour-price-input');
    const topicSelected = document.getElementById('offer-topic-selected');
    const durationSlider = document.getElementById('offer-duration-slider');
    const durationDisplay = document.getElementById('offer-duration-hours');

    if (priceInput) {
        if (window.currentOfferDraft.hourPrice && !Number.isNaN(window.currentOfferDraft.hourPrice)) {
            priceInput.value = window.currentOfferDraft.hourPrice;
        } else {
            priceInput.value = '';
        }
    }

    if (topicSelected) {
        topicSelected.textContent = window.currentOfferDraft.topic || 'Выберите тематику';
    }

    // Initialize topics menu for offer
    initOfferTopicsMenu();

    if (durationSlider && durationDisplay) {
        const hours = window.currentOfferDraft.durationHours || 1;
        durationSlider.value = String(hours);
        durationDisplay.textContent = hours;

        const updateSliderBackground = (value) => {
            const min = parseInt(durationSlider.min, 10) || 1;
            const max = parseInt(durationSlider.max, 10) || 24;
            const percentage = ((value - min) / (max - min)) * 100;
            durationSlider.style.background = `linear-gradient(to right, var(--primary-blue-dark) 0%, var(--primary-blue-dark) ${percentage}%, var(--border-color) ${percentage}%, var(--border-color) 100%)`;
        };

        updateSliderBackground(hours);

        durationSlider.oninput = function () {
            const val = parseInt(this.value, 10) || 1;
            durationDisplay.textContent = val;
            window.currentOfferDraft.durationHours = val;
            updateSliderBackground(val);

            if (tg?.HapticFeedback) {
                tg.HapticFeedback.selectionChanged();
            }
        };
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (blurOverlay) {
        blurOverlay.classList.add('active');
    }

    setTimeout(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, 50);

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

function closeOfferSettingsModal(keepBlur = false) {
    const overlay = document.getElementById('offer-settings-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    document.body.style.overflow = '';

    if (blurOverlay && !keepBlur) {
        blurOverlay.classList.remove('active');
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Выбор тематики - новый выпадающий список как на странице Buy
function toggleOfferTopicsDropdown() {
    const dropdown = document.getElementById('offer-topics-dropdown');
    const select = document.getElementById('offer-topic-select');
    if (!dropdown || !select) return;

    const isOpen = dropdown.classList.contains('open');
    if (isOpen) {
        dropdown.classList.remove('open');
        select.classList.remove('open');
    } else {
        dropdown.classList.add('open');
        select.classList.add('open');
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Initialize topics menu for offer modal
function initOfferTopicsMenu() {
    const menu = document.getElementById('offer-topics-menu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    Object.entries(TOPIC_GROUPS).forEach(([groupKey, groupData]) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'topic-group';
        groupDiv.dataset.groupKey = groupKey;
        
        const header = document.createElement('div');
        header.className = 'topic-group-header';
        
        const title = document.createElement('div');
        title.className = 'topic-group-title';
        title.textContent = groupData.title;
        
        const arrow = document.createElement('i');
        arrow.setAttribute('data-lucide', 'chevron-down');
        arrow.className = 'topic-group-arrow';
        
        header.appendChild(title);
        header.appendChild(arrow);
        
        const subtopics = document.createElement('div');
        subtopics.className = 'topic-subtopics';
        
        groupData.subtopics.forEach(([subKey, subTitle]) => {
            const item = document.createElement('div');
            item.className = 'topic-subtopic-item';
            item.dataset.groupKey = groupKey;
            item.dataset.subKey = subKey;
            
            const check = document.createElement('i');
            check.setAttribute('data-lucide', 'check');
            check.className = 'topic-check';
            
            const name = document.createElement('div');
            name.className = 'topic-subtopic-name';
            name.textContent = subTitle;
            
            item.appendChild(check);
            item.appendChild(name);
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectOfferTopic(groupKey, subKey, subTitle, item);
            });
            
            subtopics.appendChild(item);
        });
        
        header.addEventListener('click', () => {
            groupDiv.classList.toggle('expanded');
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('light');
            }
        });
        
        groupDiv.appendChild(header);
        groupDiv.appendChild(subtopics);
        menu.appendChild(groupDiv);
    });
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Select topic for offer
function selectOfferTopic(groupKey, subKey, subTitle, element) {
    // Remove selection from all items
    const menu = document.getElementById('offer-topics-menu');
    if (menu) {
        menu.querySelectorAll('.topic-subtopic-item').forEach(item => {
            item.classList.remove('selected');
        });
    }
    
    // Add selection to clicked item
    element.classList.add('selected');
    
    // Update selected topic display
    const topicKey = `${groupKey}:${subKey}`;
    window.currentOfferDraft.topic = subTitle;
    window.currentOfferDraft.topicKey = topicKey;
    
    const selected = document.getElementById('offer-topic-selected');
    if (selected) {
        selected.textContent = subTitle;
    }
    
    // Close dropdown
    const dropdown = document.getElementById('offer-topics-dropdown');
    const select = document.getElementById('offer-topic-select');
    if (dropdown) {
        dropdown.classList.remove('open');
    }
    if (select) {
        select.classList.remove('open');
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('offer-topics-dropdown');
    const select = document.getElementById('offer-topic-select');
    if (!dropdown || !select) return;

    const target = event.target;

    // If clicking on select button, let toggleOfferTopicsDropdown handle it
    if (select.contains(target)) {
        return;
    }

    // If clicking inside dropdown menu, let item handlers handle it
    if (dropdown.contains(target)) {
        return;
    }

    // Click outside - close dropdown
    if (dropdown.classList.contains('open')) {
        dropdown.classList.remove('open');
        select.classList.remove('open');
    }
});

// Назад со второго шага к первому
function backFromOfferSettingsToContent() {
    closeOfferSettingsModal(true);
    setTimeout(() => {
        openOfferPostModal();
    }, 260);
}

// Финальный сабмит создания предложения
async function submitOfferCreation() {
    const priceInput = document.getElementById('offer-hour-price-input');
    if (priceInput) {
        const val = parseFloat(priceInput.value);
        if (!val || Number.isNaN(val) || val <= 0) {
            showNotification('Укажите корректную цену за час', 'error');
            priceInput.focus();
            return;
        }
        window.currentOfferDraft.hourPrice = val;
    }

    if (!window.currentOfferDraft.durationHours) {
        window.currentOfferDraft.durationHours = 1;
    }

    const topic = window.currentOfferDraft.topic || '';
    const formData = new FormData();
    formData.append('text', window.currentOfferDraft.text || '');
    formData.append('hour_price', String(window.currentOfferDraft.hourPrice || 0));
    formData.append('duration_hours', String(window.currentOfferDraft.durationHours || 1));
    formData.append('topic', topic);

    const images = window.currentOfferDraft.images || [];
    images.forEach((file, index) => {
        formData.append(`image_${index}`, file);
    });

    try {
        showNotification('Сохраняем предложение...', 'info');
        const response = await authenticatedFetch('/api/offers/create', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Ошибка при сохранении предложения');
        }

        const result = await response.json();
        const createdOffer = result.offer;

        closeOfferSettingsModal();

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
        showNotification('Предложение сохранено', 'success');

        // Добавляем карточку оффера на страницу Offer
        const offersFeed = document.getElementById('offers-feed');
        if (offersFeed && createdOffer) {
            // Если раньше был плейсхолдер "Пока нет предложений", очищаем его
            if (offersFeed.querySelector('.coming-soon')) {
                offersFeed.innerHTML = '';
            }
            const card = createOfferCardElement(createdOffer);
            offersFeed.prepend(card);
            setTimeout(() => {
                if (window.lucide) {
                    window.lucide.createIcons();
                }
            }, 0);
        }

        // Сброс черновика
        window.currentOfferDraft = {
            images: [],
            text: '',
            hourPrice: null,
            topic: null,
            durationHours: 1
        };
    } catch (error) {
        console.error('Error submitting offer:', error);
        showNotification(error.message || 'Ошибка при сохранении предложения', 'error');
    }
}

// ===== Офер блогера: предпросмотр и выбор дня/времени публикации сохранённого предложения =====

let currentOfferPublicationContext = {
    offer: null,
    offerId: null,
    selectedDate: null,
    selectedMinutes: null
};

function openOfferNotBloggerModal() {
    const overlay = document.getElementById('offer-not-blogger-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (blurOverlay) {
        blurOverlay.classList.add('active');
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('warning');
    }

    setTimeout(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, 50);
}

function closeOfferNotBloggerModal() {
    const overlay = document.getElementById('offer-not-blogger-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    document.body.style.overflow = '';
    if (blurOverlay) {
        blurOverlay.classList.remove('active');
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Шаг 1: предпросмотр оффера (картинка + полный текст)
function openOfferPreviewModal(offer, firstImageFromCard, fullTextFromCard) {
    const overlay = document.getElementById('offer-preview-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    currentOfferPublicationContext.offer = offer;
    currentOfferPublicationContext.offerId = offer.id;
    currentOfferPublicationContext.selectedDate = null;
    currentOfferPublicationContext.selectedMinutes = null;

    const imgEl = document.getElementById('offer-preview-img');
    const titleEl = document.getElementById('offer-preview-title');
    const textEl = document.getElementById('offer-preview-text');
    const actionBtn = document.getElementById('offer-preview-action-btn');
    const deleteBtn = document.getElementById('offer-delete-btn');

    const fullText = (fullTextFromCard != null ? fullTextFromCard : (offer.text || '')).trim();
    if (textEl) {
        textEl.textContent = fullText || 'Без описания';
    }

    // Цена поста: часовая цена * срок поста, если оба значения есть
    if (titleEl) {
        const rawHour = offer.hour_price ?? offer.hourPrice ?? 0;
        const rawDuration = offer.duration_hours ?? offer.durationHours ?? 1;
        let hourPrice = Number(rawHour) || 0;
        let durationHours = Number(rawDuration) || 1;
        if (durationHours <= 0) durationHours = 1;

        let totalPrice = hourPrice * durationHours;
        if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
            totalPrice = hourPrice;
        }

        const formatted = Number.isFinite(totalPrice)
            ? totalPrice.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
            : '0';
        titleEl.textContent = `${formatted} ₽`;
    }

    if (imgEl) {
        if (firstImageFromCard) {
            imgEl.src = firstImageFromCard;
        } else {
            imgEl.src = '';
        }
    }

    // Проверяем, является ли текущий пользователь владельцем оффера
    const isOwner = offer.user_id && window.currentUserId && (offer.user_id === window.currentUserId);
    
    if (isOwner) {
        // Показываем кнопку удаления, скрываем кнопку продолжить
        if (actionBtn) actionBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'block';
    } else {
        // Показываем кнопку продолжить, скрываем кнопку удаления
        if (actionBtn) actionBtn.style.display = 'block';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (blurOverlay) {
        blurOverlay.classList.add('active');
    }

    setTimeout(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, 50);

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

function closeOfferPreviewModal(keepBlur = false) {
    const overlay = document.getElementById('offer-preview-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    document.body.style.overflow = '';
    if (blurOverlay && !keepBlur) {
        blurOverlay.classList.remove('active');
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Delete offer function
async function deleteOffer() {
    const offer = currentOfferPublicationContext.offer;
    if (!offer || !offer.id) {
        showNotification('Не удалось определить оффер для удаления', 'error');
        return;
    }

    // Confirm deletion
    if (tg?.showConfirm) {
        const confirmed = await new Promise((resolve) => {
            tg.showConfirm('Вы уверены, что хотите удалить этот оффер?', (result) => {
                resolve(result);
            });
        });
        
        if (!confirmed) {
            return;
        }
    }

    try {
        showNotification('Удаление оффера...', 'info');
        
        const response = await authenticatedFetch(`/api/offers/${offer.id}/delete`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Ошибка при удалении оффера');
        }

        // Close modal
        closeOfferPreviewModal();

        // Remove offer card from feed
        const offersFeed = document.getElementById('offers-feed');
        if (offersFeed) {
            const cards = offersFeed.querySelectorAll('.blogger-card-wrapper');
            cards.forEach(card => {
                const cardOfferId = card.dataset.offerId;
                if (cardOfferId && parseInt(cardOfferId) === offer.id) {
                    card.remove();
                }
            });

            // Check if feed is empty
            if (offersFeed.children.length === 0) {
                offersFeed.innerHTML = `
                    <div class="coming-soon">
                        <div class="empty-icon">
                            <i data-lucide="shopping-bag"></i>
                        </div>
                        <h3>Пока нет предложений</h3>
                        <p>Нажмите «Добавить предложение», чтобы создать своё первое предложение.</p>
                    </div>
                `;
                setTimeout(() => {
                    if (window.lucide) {
                        window.lucide.createIcons();
                    }
                }, 0);
            }
        }

        showNotification('Оффер успешно удалён', 'success');

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
    } catch (error) {
        console.error('Error deleting offer:', error);
        showNotification(error.message || 'Не удалось удалить оффер', 'error');
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }
    }
}

function continueFromOfferPreview() {
    // Закрываем предпросмотр, но оставляем блюр, чтобы сразу открыть модалку даты
    closeOfferPreviewModal(true);
    const offer = currentOfferPublicationContext.offer;
    if (!offer) {
        return;
    }
    setTimeout(() => {
        openOfferPublicationModal(offer);
    }, 260);
}

// Шаг 2: выбор дня и времени публикации
function openOfferPublicationModal(offer) {
    const overlay = document.getElementById('offer-publication-modal-overlay');
    const calendar = document.getElementById('offer-publication-week-calendar');
    const timeContainer = document.getElementById('offer-publication-time-container');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay || !calendar || !timeContainer) return;

    currentOfferPublicationContext.offer = offer;
    currentOfferPublicationContext.offerId = offer.id;
    currentOfferPublicationContext.selectedDate = null;
    currentOfferPublicationContext.selectedMinutes = null;

    const baseDate = new Date();
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() + i);
        days.push({
            date: d,
            info: getDayInfoFromDate(d),
            index: i
        });
    }

    calendar.innerHTML = '';
    // Прячем ползунок до тех пор, пока пользователь не выберет день
    timeContainer.style.display = 'none';

    const createDayButton = (dayObj) => {
        const { date, info, index } = dayObj;
        const btn = document.createElement('button');
        btn.className = 'week-day-btn';
        btn.dataset.index = String(index);
        btn.dataset.date = formatLocalDateYMD(date);
        btn.dataset.fullDay = info.full;

        btn.innerHTML = `
            <div class="week-day-info">
                <div class="week-day-name">${info.short}</div>
                <div class="week-day-date">${info.displayDate}</div>
            </div>
        `;

        btn.addEventListener('click', () => {
            const alreadySelected = calendar.querySelector('.week-day-btn.selected');
            if (alreadySelected && alreadySelected !== btn) {
                alreadySelected.classList.remove('selected');
            }
            btn.classList.add('selected');
            currentOfferPublicationContext.selectedDate = new Date(date);

            // Показываем блок выбора времени только после выбора дня
            timeContainer.style.display = 'block';
            updateOfferPublicationTimeSection(date, info);
        });

        return btn;
    };

    const firstRow = document.createElement('div');
    firstRow.className = 'week-calendar-row week-calendar-row-single';
    firstRow.appendChild(createDayButton(days[0]));
    calendar.appendChild(firstRow);

    const remaining = days.slice(1);
    for (let i = 0; i < remaining.length; i += 2) {
        const row = document.createElement('div');
        row.className = 'week-calendar-row';
        row.appendChild(createDayButton(remaining[i]));
        if (remaining[i + 1]) {
            row.appendChild(createDayButton(remaining[i + 1]));
        }
        calendar.appendChild(row);
    }

    overlay.classList.add('active', 'day-picker-active');
    if (blurOverlay) {
        blurOverlay.classList.add('active', 'above-modals');
    }

    setTimeout(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, 50);

    const timeDisplayEl = document.getElementById('offer-publication-time-display');
    if (typeof attachTimeInputMask === 'function' && timeDisplayEl) {
        attachTimeInputMask(timeDisplayEl);
    }
    setupOfferPublicationTimeInput();

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

function closeOfferPublicationModal() {
    const overlay = document.getElementById('offer-publication-modal-overlay');
    const blurOverlay = document.getElementById('page-blur-overlay');
    if (!overlay) return;

    overlay.classList.remove('active', 'day-picker-active');
    if (blurOverlay) {
        blurOverlay.classList.remove('above-modals');
        blurOverlay.classList.remove('active');
    }
    document.body.style.overflow = '';

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

function updateOfferPublicationTimeSection(date, info) {
    const dayLabelEl = document.getElementById('offer-publication-day-label');
    const timeDisplayEl = document.getElementById('offer-publication-time-display');
    const timeSliderEl = document.getElementById('offer-publication-time-slider');
    const rangeEl = document.getElementById('offer-publication-slider-range');
    const minLabelEl = document.getElementById('offer-publication-time-min-label');
    const maxLabelEl = document.getElementById('offer-publication-time-max-label');

    if (!dayLabelEl || !timeDisplayEl || !timeSliderEl || !rangeEl) {
        return;
    }

    dayLabelEl.textContent = info.full || info.short || '';

    let minutes = currentOfferPublicationContext.selectedMinutes;
    if (minutes === null || Number.isNaN(minutes)) {
        const now = new Date();
        minutes = now.getHours() * 60 + now.getMinutes();
    }

    const minMinutes = 0;
    const maxMinutes = 1439;

    minutes = Math.max(minMinutes, Math.min(maxMinutes, minutes));

    timeSliderEl.min = String(minMinutes);
    timeSliderEl.max = String(maxMinutes);
    timeSliderEl.value = String(minutes);

    if (typeof minutesToTime === 'function') {
        timeDisplayEl.value = minutesToTime(minutes);
    } else {
        const h = String(Math.floor(minutes / 60)).padStart(2, '0');
        const m = String(minutes % 60).padStart(2, '0');
        timeDisplayEl.value = `${h}:${m}`;
    }

    if (minLabelEl) minLabelEl.textContent = '00:00';
    if (maxLabelEl) maxLabelEl.textContent = '23:59';

    const percent = (minutes / maxMinutes) * 100;
    rangeEl.style.left = '0%';
    rangeEl.style.width = `${percent}%`;

    currentOfferPublicationContext.selectedMinutes = minutes;
}

function setupOfferPublicationTimeInput() {
    const timeDisplayEl = document.getElementById('offer-publication-time-display');
    const slider = document.getElementById('offer-publication-time-slider');
    const rangeEl = document.getElementById('offer-publication-slider-range');
    if (!timeDisplayEl || !slider || !rangeEl) return;

    slider.addEventListener('input', () => {
        let minutesTotal = parseInt(slider.value, 10);
        if (Number.isNaN(minutesTotal)) minutesTotal = 0;

        const max = parseInt(slider.max, 10) || 1439;
        minutesTotal = Math.max(0, Math.min(max, minutesTotal));

        currentOfferPublicationContext.selectedMinutes = minutesTotal;

        if (typeof minutesToTime === 'function') {
            timeDisplayEl.value = minutesToTime(minutesTotal);
        } else {
            const h = String(Math.floor(minutesTotal / 60)).padStart(2, '0');
            const m = String(minutesTotal % 60).padStart(2, '0');
            timeDisplayEl.value = `${h}:${m}`;
        }

        const percent = (minutesTotal / max) * 100;
        rangeEl.style.left = '0%';
        rangeEl.style.width = `${percent}%`;

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.selectionChanged();
        }
    });

    const applyManualTime = () => {
        let value = (timeDisplayEl.value || '').trim();
        if (!value) return;

        value = value.replace(/\D/g, '').slice(0, 4);
        if (value.length < 3) return;

        let hours = parseInt(value.slice(0, 2), 10);
        let mins = parseInt(value.slice(2, 4), 10);
        if (Number.isNaN(hours)) hours = 0;
        if (Number.isNaN(mins)) mins = 0;

        hours = Math.max(0, Math.min(23, hours));
        mins = Math.max(0, Math.min(59, mins));

        let minutesTotal = hours * 60 + mins;
        const max = parseInt(slider.max, 10) || 1439;
        minutesTotal = Math.max(0, Math.min(max, minutesTotal));

        currentOfferPublicationContext.selectedMinutes = minutesTotal;
        slider.value = String(minutesTotal);

        if (typeof minutesToTime === 'function') {
            timeDisplayEl.value = minutesToTime(minutesTotal);
        } else {
            const h = String(Math.floor(minutesTotal / 60)).padStart(2, '0');
            const m = String(minutesTotal % 60).padStart(2, '0');
            timeDisplayEl.value = `${h}:${m}`;
        }

        const percent = (minutesTotal / max) * 100;
        rangeEl.style.left = '0%';
        rangeEl.style.width = `${percent}%`;
    };

    timeDisplayEl.addEventListener('blur', applyManualTime);
    timeDisplayEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyManualTime();
            timeDisplayEl.blur();
        }
    });
}

async function submitOfferPublicationTime() {
    const ctx = currentOfferPublicationContext;
    if (!ctx.offerId) {
        closeOfferPublicationModal();
        return;
    }

    if (!currentUserIsBlogger) {
        openOfferNotBloggerModal();
        return;
    }

    if (!ctx.selectedDate) {
        ctx.selectedDate = new Date();
    }
    let minutes = ctx.selectedMinutes;
    if (minutes === null || Number.isNaN(minutes)) {
        const now = new Date();
        minutes = now.getHours() * 60 + now.getMinutes();
    }

    const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mins = String(minutes % 60).padStart(2, '0');

    const localDate = new Date(ctx.selectedDate);
    const ymd = formatLocalDateYMD(localDate);
    const isoString = `${ymd}T${hours}:${mins}`;

    try {
        showNotification('Сохраняем предложение публикации...', 'info');
        const response = await authenticatedFetch(`/api/offers/${ctx.offerId}/propose_publication`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify({ scheduled_time: isoString })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            const msg = data.error || 'Не удалось сохранить предложение публикации';
            showNotification(msg, 'error');
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('error');
            }
            return;
        }

        closeOfferPublicationModal();

        showNotification('Предложение публикации сохранено', 'success');
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
    } catch (e) {
        console.error('Error proposing offer publication:', e);
        showNotification('Не удалось сохранить предложение публикации', 'error');
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }
    }
}

// Handle chat action (called from blogger detail modal)
function handleChat() {
    console.log('🔍 handleChat called'); // DEBUG
    console.log('   📦 window.currentBloggerData:', window.currentBloggerData); // DEBUG
    console.log('   🔑 window.currentBloggerData.channel_id:', window.currentBloggerData?.channel_id); // DEBUG
    console.log('   🔑 window.currentBloggerData.id:', window.currentBloggerData?.id); // DEBUG
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    // ИСПРАВЛЕНИЕ: Используем сохраненные данные блогера вместо чтения из DOM
    // Это гарантирует что аватарка будет правильной
    const bloggerData = {
        image: window.currentBloggerData?.image || '',
        photo_url: window.currentBloggerData?.image || '',
        name: window.currentBloggerData?.name || '@channel',
        subscribers: window.currentBloggerData?.subscribers || '0',
        price: window.currentBloggerData?.price || '0 ₽',
        user_id: window.currentBloggerUserId || null,
        channel_id: window.currentBloggerData?.channel_id || window.currentBloggerData?.id || null, // ДОБАВЛЕНО: channel_id
        channel_link: window.currentBloggerData?.channel_link || ''
    };
    
    console.log('   ✅ Prepared bloggerData for chat:', bloggerData); // DEBUG
    console.log('📨 Opening chat with channel_id:', bloggerData.channel_id); // DEBUG
    
    // Close blogger modal first
    closeBloggerModal();
    
    // Open chat modal after a short delay
    setTimeout(() => {
        openChatModal(bloggerData);
    }, 300);
}

// ===== SETTINGS MODAL FUNCTIONALITY =====

// Open settings modal
function openSettingsModal() {
    const modalOverlay = document.getElementById('settings-modal-overlay');
    const referralLinkText = document.getElementById('referral-link-text');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Add blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }
        
        // Update referral link text
        if (referralLinkText && window.currentUserId) {
            const baseUrl = 't.me/admarket_testbot/apptest';
            referralLinkText.textContent = `${baseUrl}?startapp=ref_${window.currentUserId}`;
        }

        // Load saved settings
        loadSettingsState();
        
        // Initialize Lucide icons for the modal
        setTimeout(() => {
            lucide.createIcons();
        }, 50);
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
    }
}

// Close referral modal
function closeReferralModal() {
    const overlay = document.getElementById('referral-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');

    if (overlay) {
        overlay.classList.remove('active');
    }
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.remove('active');
    }
}

// Open referral modal from settings
async function openReferralModal() {
    // Close settings modal first
    closeSettingsModal();

    const overlay = document.getElementById('referral-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');

    if (!overlay) return;

    // Show overlay + blur
    overlay.classList.add('active');
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.add('active');
    }

    // Update referral link text in modal
    const referralModalLinkText = document.getElementById('referral-modal-link-text');
    if (referralModalLinkText && window.currentUserId) {
        const baseUrl = 't.me/admarket_testbot/apptest';
        referralModalLinkText.textContent = `${baseUrl}?startapp=ref_${window.currentUserId}`;
    }

    // Load referral data from backend
    try {
        if (typeof authenticatedFetch === 'function') {
            const response = await authenticatedFetch('/api/referrals');
            if (!response.ok) {
                throw new Error('Ошибка загрузки рефералов');
            }
            const data = await response.json();
            renderReferralData(data);
        }
    } catch (e) {
        console.error('Error loading referrals:', e);
        if (typeof showNotification === 'function') {
            showNotification('Не удалось загрузить рефералов', 'error', 'Ошибка');
        }
    }

    // Initialize Lucide icons for the modal
    setTimeout(() => {
        lucide.createIcons();
    }, 50);

    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

// Render referral list and count
function renderReferralData(data) {
    const countEl = document.getElementById('referral-count');
    const listEl = document.getElementById('referral-list');

    if (!listEl || !countEl) return;

    const referrals = Array.isArray(data?.referrals) ? data.referrals : [];
    countEl.textContent = data?.count ?? referrals.length;

    listEl.innerHTML = '';

    if (!referrals.length) {
        const empty = document.createElement('div');
        empty.className = 'referral-list-empty';
        empty.textContent = 'Пока нет рефералов. Поделитесь ссылкой, чтобы начать зарабатывать.';
        listEl.appendChild(empty);
        return;
    }

    referrals.forEach((ref) => {
        const item = document.createElement('div');
        item.className = 'referral-item';

        const avatar = document.createElement('img');
        avatar.className = 'referral-avatar';
        avatar.src = ref.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(ref.display_name || 'User')}&background=111827&color=f9fafb&size=200`;
        avatar.alt = ref.display_name || 'User';

        const main = document.createElement('div');
        main.className = 'referral-main';

        const name = document.createElement('div');
        name.className = 'referral-name';
        name.textContent = ref.display_name || `ID: ${ref.user_id}`;

        const meta = document.createElement('div');
        meta.className = 'referral-meta';
        meta.textContent = ref.username ? `@${ref.username}` : `ID: ${ref.user_id}`;

        const amount = document.createElement('div');
        amount.className = 'referral-amount';
        const earned = typeof ref.total_commission === 'number' ? ref.total_commission : 0;
        amount.textContent = `${earned.toFixed(2)} ₽`;

        main.appendChild(name);
        main.appendChild(meta);

        item.appendChild(avatar);
        item.appendChild(main);
        item.appendChild(amount);

        listEl.appendChild(item);
    });
}

// Copy referral link to clipboard
async function copyReferralLink() {
    const linkEl = document.getElementById('referral-link-text');
    if (!linkEl) return;

    const text = linkEl.textContent || '';
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const tempInput = document.createElement('input');
            tempInput.value = text;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
        }

        if (typeof showNotification === 'function') {
            showNotification('Реферальная ссылка скопирована', 'success', 'Скопировано');
        }

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
    } catch (e) {
        console.error('Error copying link:', e);
    }
}

async function copyReferralModalLink() {
    const linkEl = document.getElementById('referral-modal-link-text');
    if (!linkEl) return;

    const text = linkEl.textContent || '';
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const tempInput = document.createElement('input');
            tempInput.value = text;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
        }

        if (typeof showNotification === 'function') {
            showNotification('Реферальная ссылка скопирована', 'success', 'Скопировано');
        }

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
    } catch (e) {
        console.error('Copy failed:', e);
        if (typeof showNotification === 'function') {
            showNotification('Не удалось скопировать ссылку', 'error', 'Ошибка');
        }
    }
}
// Load settings state from localStorage
function loadSettingsState() {
    // Load vibration setting
    const vibrationEnabled = localStorage.getItem('vibration_enabled') !== 'false';
    const vibrationToggle = document.getElementById('vibration-toggle');
    if (vibrationToggle) {
        if (vibrationEnabled) {
            vibrationToggle.classList.add('active');
        } else {
            vibrationToggle.classList.remove('active');
        }
    }
}

// Close settings modal
function closeSettingsModal() {
    const modalOverlay = document.getElementById('settings-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        // Remove blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// ===== SIMPLE I18N SYSTEM =====

const UI_TRANSLATIONS = {
    ru: {
        // Buy page
        search_placeholder: 'Поиск блогеров...',
        filter_all: 'Все',
        filter_popular: 'Популярные',
        filter_price: 'По цене',

        // Profile page
        profile_orders_label: 'Заказов',
        profile_spent_label: 'Потрачено',
        profile_become_blogger: 'стать блогером агенства MEDIA PRIME',
        profile_history_btn: 'История',
        profile_ads_btn: 'Реклама',
        profile_expenses_stats_title: 'Реферальная система',
        profile_expenses_stats_placeholder: 'Статистика появится после первого заказа',

        // Blogger modal actions
        blogger_make_offer_btn: 'Сделать оффер',
        blogger_buy_ad_btn: 'Купить рекламу',

        // Post creation / purchase flow
        post_creation_title: 'Оформление поста',
        post_creation_subtitle: 'Напишите текст и добавьте изображения для размещения',
        post_creation_placeholder_text: 'Нажмите для загрузки фото',
        post_creation_textarea_placeholder: 'Текст рекламного поста, промокод, ссылка и другие детали...',
        post_creation_error_with_media: 'Максимальное количество символов с фото: {limit}',

        // FAQ page
        faq_subtitle: 'Часто задаваемые вопросы',
        faq_step1_title: 'Найдите блогера',
        faq_step1_text: 'Используйте поиск и фильтры в разделе «Купить», чтобы найти подходящих блогеров для вашей рекламы',
        faq_step2_title: 'Выберите формат',
        faq_step2_text: 'Определите тип рекламы: пост, история, видео или интеграция. Каждый формат имеет свою стоимость',
        faq_step3_title: 'Забронируйте дату',
        faq_step3_text: 'Выберите удобную дату размещения в календаре блогера и оплатите заказ',
        faq_step4_title: 'Отслеживайте результат',
        faq_step4_text: 'Получайте статистику по просмотрам, кликам и конверсии в разделе «Профиль»',
        faq_tips_title: 'Полезные советы',
        faq_tip1: 'Изучите аудиторию блогера перед заказом',
        faq_tip2: 'Подготовьте качественный контент для рекламы',
        faq_tip3: 'Используйте A/B тестирование для разных форматов',
        faq_tip4: 'Анализируйте результаты для улучшения ROI',

        // Settings modal
        settings_language_title: 'ЯЗЫК',
        settings_vibration_title: 'ВИБРАЦИЯ',
        settings_vibration_label: 'Вибрация',
        settings_faq: 'FAQ',
        settings_support: 'Поддержка',

        // Orders / Ads empty states
        orders_empty_title: 'Пока нет заказов',
        orders_empty_text: 'Ваши заказы будут отображаться здесь после их создания',
        orders_empty_cta: 'Создать первый заказ',

        ads_empty_title: 'Нет активной рекламы',
        ads_empty_text: 'Ваши активные рекламные кампании будут отображаться здесь',
        ads_empty_cta: 'Запустить рекламу',

        // Balance / payments
        topup_title: 'Пополнение баланса',
        topup_description: 'Выберите сумму пополнения и подтвердите оплату',
        topup_button: 'Пополнить',
        topup_history_link: 'История платежей',

        // Purchase modal
        purchase_title: 'Покупка рекламы',
        purchase_blogger_label: 'Блогер: {name}',
        purchase_insufficient_title: 'Недостаточно средств',
        purchase_insufficient_text: 'Для покупки рекламы необходимо пополнить баланс',
        purchase_balance_label: 'Ваш баланс:',
        purchase_current_balance_label: 'Текущий баланс:',
        purchase_required_label: 'Требуется:',
        purchase_shortage_label: 'Нехватает:',
        purchase_price_24h_label: 'Стоимость за 24 часа:',
        purchase_total_label: 'Итоговая стоимость:',
        purchase_time_title: 'Укажите время поста в ленте',
        purchase_time_hint: '*по истечению этого времени пост будет удален',
        purchase_hours_label: 'часов',
        purchase_duration_min_label: '1ч',
        purchase_duration_max_label: '24ч',
        purchase_datetime_label: 'Дата и время публикации',
        purchase_day_pill_default: 'День',
        purchase_continue_btn: 'Продолжить',
        purchase_topup_btn: 'Пополнить баланс',
        purchase_balance_check_error: 'Ошибка при проверке баланса',

        // Chat page
        chat_title: 'Чаты',
        chat_subtitle: 'Ваши диалоги',
        chat_input_placeholder: 'Введите сообщение',

        // Offer modal
        offer_current_price_label: 'Текущая цена',
        offer_your_price_label: 'Ваше предложение',
        offer_price_placeholder: 'Введите сумму',
        common_back: 'Назад',
        common_continue: 'Продолжить',

        // Schedule / day picker
        schedule_title: 'График постов',
        schedule_hint: '*Зажмите день недели, чтобы настроить доступное время для рекламных постов',
        schedule_cancel: 'Отмена',
        schedule_save: 'Сохранить',
        day_picker_title: 'Выберите день публикации'
    },
    en: {
        // Buy page
        search_placeholder: 'Search creators...',
        filter_all: 'All',
        filter_popular: 'Popular',
        filter_price: 'By price',

        // Profile page
        profile_orders_label: 'Orders',
        profile_spent_label: 'Spent',
        profile_become_blogger: 'become a MEDIA PRIME agency creator',
        profile_history_btn: 'History',
        profile_ads_btn: 'Ads',
        profile_expenses_stats_title: 'Referral System',
        profile_expenses_stats_placeholder: 'Statistics will appear after your first order',

        // Blogger modal actions
        blogger_make_offer_btn: 'Make offer',
        blogger_buy_ad_btn: 'Buy ads',

        // Post creation / purchase flow
        post_creation_title: 'Post setup',
        post_creation_subtitle: 'Write the text and add images for placement',
        post_creation_placeholder_text: 'Tap to upload photos',
        post_creation_textarea_placeholder: 'Ad post text, promo code, link and other details...',
        post_creation_error_with_media: 'Maximum characters with media: {limit}',

        // FAQ page
        faq_subtitle: 'Frequently asked questions',
        faq_step1_title: 'Find a creator',
        faq_step1_text: 'Use search and filters in the “Buy” section to find suitable creators for your ads',
        faq_step2_title: 'Choose a format',
        faq_step2_text: 'Choose the ad type: post, story, video or integration. Each format has its own price',
        faq_step3_title: 'Book a date',
        faq_step3_text: 'Select a convenient publication date in the creator’s calendar and pay for the order',
        faq_step4_title: 'Track results',
        faq_step4_text: 'Track views, clicks and conversions in the “Profile” section',
        faq_tips_title: 'Helpful tips',
        faq_tip1: 'Study the creator’s audience before placing an order',
        faq_tip2: 'Prepare high‑quality content for your ad',
        faq_tip3: 'Use A/B testing for different formats',
        faq_tip4: 'Analyze results to improve ROI',

        // Settings modal
        settings_language_title: 'LANGUAGE',
        settings_vibration_title: 'VIBRATION',
        settings_vibration_label: 'Vibration',
        settings_faq: 'FAQ',
        settings_support: 'Support',

        // Orders / Ads empty states
        orders_empty_title: 'No orders yet',
        orders_empty_text: 'Your orders will appear here after you create them',
        orders_empty_cta: 'Create first order',

        ads_empty_title: 'No active ads',
        ads_empty_text: 'Your active ad campaigns will be shown here',
        ads_empty_cta: 'Launch ads',

        // Balance / payments
        topup_title: 'Balance top‑up',
        topup_description: 'Choose a top‑up amount and confirm the payment',
        topup_button: 'Top up',
        topup_history_link: 'Payment history',

        // Purchase modal
        purchase_title: 'Ad purchase',
        purchase_blogger_label: 'Creator: {name}',
        purchase_insufficient_title: 'Insufficient funds',
        purchase_insufficient_text: 'To buy this ad you need to top up your balance',
        purchase_balance_label: 'Your balance:',
        purchase_current_balance_label: 'Current balance:',
        purchase_required_label: 'Required:',
        purchase_shortage_label: 'Missing:',
        purchase_price_24h_label: 'Price for 24 hours:',
        purchase_total_label: 'Total cost:',
        purchase_time_title: 'Set how long the post stays in the feed',
        purchase_time_hint: '*after this time the post will be removed',
        purchase_hours_label: 'hours',
        purchase_duration_min_label: '1h',
        purchase_duration_max_label: '24h',
        purchase_datetime_label: 'Date and time of publication',
        purchase_day_pill_default: 'Day',
        purchase_continue_btn: 'Continue',
        purchase_topup_btn: 'Top up balance',
        purchase_balance_check_error: 'Error while checking balance',

        // Chat page
        chat_title: 'Chats',
        chat_subtitle: 'Your conversations',
        chat_input_placeholder: 'Type a message',

        // Offer modal
        offer_current_price_label: 'Current price',
        offer_your_price_label: 'Your offer',
        offer_price_placeholder: 'Enter amount',
        common_back: 'Back',
        common_continue: 'Continue',

        // Schedule / day picker
        schedule_title: 'Posting schedule',
        schedule_hint: '*Long‑press a weekday to configure available time for sponsored posts',
        schedule_cancel: 'Cancel',
        schedule_save: 'Save',
        day_picker_title: 'Choose publication day'
    },
    uk: {
        // Buy page
        search_placeholder: 'Пошук блогерів...',
        filter_all: 'Усі',
        filter_popular: 'Популярні',
        filter_price: 'За ціною',

        // Profile page
        profile_orders_label: 'Замовлень',
        profile_spent_label: 'Витрачено',
        profile_become_blogger: 'стати блогером агенції MEDIA PRIME',
        profile_history_btn: 'Історія',
        profile_ads_btn: 'Реклама',
        profile_expenses_stats_title: 'Реферальна система',
        profile_expenses_stats_placeholder: 'Статистика з’явиться після першого замовлення',

        // Blogger modal actions
        blogger_make_offer_btn: 'Зробити оффер',
        blogger_buy_ad_btn: 'Купити рекламу',

        // Post creation / purchase flow
        post_creation_title: 'Оформлення посту',
        post_creation_subtitle: 'Напишіть текст і додайте зображення для розміщення',
        post_creation_placeholder_text: 'Натисніть, щоб завантажити фото',
        post_creation_textarea_placeholder: 'Текст рекламного посту, промокод, посилання та інші деталі...',
        post_creation_error_with_media: 'Максимальна кількість символів із фото: {limit}',

        // FAQ page
        faq_subtitle: 'Поширені запитання',
        faq_step1_title: 'Знайдіть блогера',
        faq_step1_text: 'Використовуйте пошук і фільтри в розділі «Купити», щоб знайти відповідних блогерів для вашої реклами',
        faq_step2_title: 'Оберіть формат',
        faq_step2_text: 'Визначте тип реклами: пост, історія, відео чи інтеграція. Кожен формат має свою вартість',
        faq_step3_title: 'Забронюйте дату',
        faq_step3_text: 'Оберіть зручну дату розміщення в календарі блогера та оплатіть замовлення',
        faq_step4_title: 'Відстежуйте результат',
        faq_step4_text: 'Отримуйте статистику за переглядами, кліками та конверсією в розділі «Профіль»',
        faq_tips_title: 'Корисні поради',
        faq_tip1: 'Вивчіть аудиторію блогера перед замовленням',
        faq_tip2: 'Підготуйте якісний контент для реклами',
        faq_tip3: 'Використовуйте A/B‑тестування для різних форматів',
        faq_tip4: 'Аналізуйте результати, щоб підвищити ROI',

        // Settings modal
        settings_language_title: 'МОВА',
        settings_vibration_title: 'ВІБРАЦІЯ',
        settings_vibration_label: 'Вібрація',
        settings_faq: 'FAQ',
        settings_support: 'Підтримка',

        // Orders / Ads empty states
        orders_empty_title: 'Поки що немає замовлень',
        orders_empty_text: 'Ваші замовлення з’являться тут після створення',
        orders_empty_cta: 'Створити перше замовлення',

        ads_empty_title: 'Немає активної реклами',
        ads_empty_text: 'Ваші активні рекламні кампанії будуть відображатися тут',
        ads_empty_cta: 'Запустити рекламу',

        // Balance / payments
        topup_title: 'Поповнення балансу',
        topup_description: 'Оберіть суму поповнення та підтвердіть оплату',
        topup_button: 'Поповнити',
        topup_history_link: 'Історія платежів',

        // Purchase modal
        purchase_title: 'Покупка реклами',
        purchase_blogger_label: 'Блогер: {name}',
        purchase_insufficient_title: 'Недостатньо коштів',
        purchase_insufficient_text: 'Щоб купити цю рекламу, поповніть баланс',
        purchase_balance_label: 'Ваш баланс:',
        purchase_current_balance_label: 'Поточний баланс:',
        purchase_required_label: 'Потрібно:',
        purchase_shortage_label: 'Не вистачає:',
        purchase_price_24h_label: 'Вартість за 24 години:',
        purchase_total_label: 'Підсумкова вартість:',
        purchase_time_title: 'Вкажіть час розміщення посту в стрічці',
        purchase_time_hint: '*після закінчення цього часу пост буде видалено',
        purchase_hours_label: 'годин',
        purchase_duration_min_label: '1год',
        purchase_duration_max_label: '24год',
        purchase_datetime_label: 'Дата та час публікації',
        purchase_day_pill_default: 'День',
        purchase_continue_btn: 'Продовжити',
        purchase_topup_btn: 'Поповнити баланс',
        purchase_balance_check_error: 'Помилка під час перевірки балансу',

        // Chat page
        chat_title: 'Чати',
        chat_subtitle: 'Ваші діалоги',
        chat_input_placeholder: 'Введіть повідомлення',

        // Offer modal
        offer_current_price_label: 'Поточна ціна',
        offer_your_price_label: 'Ваша пропозиція',
        offer_price_placeholder: 'Введіть суму',
        common_back: 'Назад',
        common_continue: 'Продовжити',

        // Schedule / day picker
        schedule_title: 'Графік постів',
        schedule_hint: '*Затисніть день тижня, щоб налаштувати доступний час для рекламних постів',
        schedule_cancel: 'Скасувати',
        schedule_save: 'Зберегти',
        day_picker_title: 'Оберіть день публікації'
    }
};

function setTextWithIcon(container, text) {
    if (!container) return;
    const textNode = Array.from(container.childNodes || []).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    if (textNode) {
        textNode.textContent = ' ' + text;
    } else {
        const span = document.createElement('span');
        span.textContent = text;
        container.appendChild(span);
    }
}

function setButtonLabelWithIcon(button, text) {
    if (!button) return;
    const existingLabel = button.querySelector('.btn-label');
    if (existingLabel) {
        existingLabel.textContent = text;
        return;
    }
    const textNode = Array.from(button.childNodes || []).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    if (textNode) {
        textNode.textContent = ' ' + text;
    } else {
        const span = document.createElement('span');
        span.className = 'btn-label';
        span.textContent = text;
        button.appendChild(span);
    }
}

function applyLanguage(lang) {
    const dict = UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.ru;
    if (!dict) return;

    // Buy page
    const searchInput = document.getElementById('search-input');
    if (searchInput && dict.search_placeholder) {
        searchInput.placeholder = dict.search_placeholder;
    }

    setButtonLabelWithIcon(
        document.querySelector('.filter-btn[data-filter="all"]'),
        dict.filter_all
    );
    setButtonLabelWithIcon(
        document.querySelector('.filter-btn[data-filter="popular"]'),
        dict.filter_popular
    );
    setButtonLabelWithIcon(
        document.querySelector('.filter-btn[data-filter="price"]'),
        dict.filter_price
    );

    // Profile stats labels
    const statLabels = document.querySelectorAll('.profile-stats-grid .stat-label-grid');
    if (statLabels[0] && dict.profile_orders_label) {
        statLabels[0].textContent = dict.profile_orders_label;
    }
    if (statLabels[1] && dict.profile_spent_label) {
        statLabels[1].textContent = dict.profile_spent_label;
    }

    // Profile square buttons (History / Ads)
    const squareButtons = document.querySelectorAll(
        '#profile-page .square-buttons-grid .square-btn-title'
    );
    if (squareButtons[0] && dict.profile_history_btn) {
        squareButtons[0].textContent = dict.profile_history_btn;
    }
    if (squareButtons[1] && dict.profile_ads_btn) {
        squareButtons[1].textContent = dict.profile_ads_btn;
    }

    // Become blogger link: keep banner image, only localize alt text
    const bloggerLink = document.getElementById('blogger-link');
    if (bloggerLink && dict.profile_become_blogger) {
        const img = bloggerLink.querySelector('img');
        if (img) {
            img.alt = dict.profile_become_blogger;
        }
    }

    // Profile expenses section
    const expensesTitle = document.querySelector(
        '#profile-page .section-card .section-header h3'
    );
    if (expensesTitle && dict.profile_expenses_stats_title) {
        expensesTitle.textContent = dict.profile_expenses_stats_title;
    }
    const expensesPlaceholder = document.querySelector(
        '#profile-page .chart-placeholder p'
    );
    if (expensesPlaceholder && dict.profile_expenses_stats_placeholder) {
        expensesPlaceholder.textContent = dict.profile_expenses_stats_placeholder;
    }

    // FAQ page
    const faqSubtitle = document.querySelector('#faq-page .page-subtitle');
    if (faqSubtitle && dict.faq_subtitle) {
        faqSubtitle.textContent = dict.faq_subtitle;
    }

    const faqSteps = document.querySelectorAll('#faq-page .step-card');
    if (faqSteps[0]) {
        const h = faqSteps[0].querySelector('h3');
        const p = faqSteps[0].querySelector('p');
        if (h && dict.faq_step1_title) h.textContent = dict.faq_step1_title;
        if (p && dict.faq_step1_text) p.textContent = dict.faq_step1_text;
    }
    if (faqSteps[1]) {
        const h = faqSteps[1].querySelector('h3');
        const p = faqSteps[1].querySelector('p');
        if (h && dict.faq_step2_title) h.textContent = dict.faq_step2_title;
        if (p && dict.faq_step2_text) p.textContent = dict.faq_step2_text;
    }
    if (faqSteps[2]) {
        const h = faqSteps[2].querySelector('h3');
        const p = faqSteps[2].querySelector('p');
        if (h && dict.faq_step3_title) h.textContent = dict.faq_step3_title;
        if (p && dict.faq_step3_text) p.textContent = dict.faq_step3_text;
    }
    if (faqSteps[3]) {
        const h = faqSteps[3].querySelector('h3');
        const p = faqSteps[3].querySelector('p');
        if (h && dict.faq_step4_title) h.textContent = dict.faq_step4_title;
        if (p && dict.faq_step4_text) p.textContent = dict.faq_step4_text;
    }

    const tipsTitle = document.querySelector('#faq-page .tips-section h3');
    if (tipsTitle && dict.faq_tips_title) {
        setTextWithIcon(tipsTitle, dict.faq_tips_title);
    }

    const tipsItems = document.querySelectorAll('#faq-page .tips-list .tip-item span');
    if (tipsItems[0] && dict.faq_tip1) tipsItems[0].textContent = dict.faq_tip1;
    if (tipsItems[1] && dict.faq_tip2) tipsItems[1].textContent = dict.faq_tip2;
    if (tipsItems[2] && dict.faq_tip3) tipsItems[2].textContent = dict.faq_tip3;
    if (tipsItems[3] && dict.faq_tip4) tipsItems[3].textContent = dict.faq_tip4;

    // Settings modal
    const settingsSections = document.querySelectorAll(
        '#settings-modal .settings-section-header h3'
    );
    if (settingsSections[0] && dict.settings_language_title) {
        settingsSections[0].textContent = dict.settings_language_title;
    }
    if (settingsSections[1] && dict.settings_vibration_title) {
        settingsSections[1].textContent = dict.settings_vibration_title;
    }

    const vibrationLabel = document.querySelector(
        '#settings-modal .settings-toggle-label'
    );
    if (vibrationLabel && dict.settings_vibration_label) {
        vibrationLabel.textContent = dict.settings_vibration_label;
    }

    const settingsFaqBtn = document.querySelector(
        '.settings-bottom-actions .settings-action-btn:not(.primary) span'
    );
    if (settingsFaqBtn && dict.settings_faq) {
        settingsFaqBtn.textContent = dict.settings_faq;
    }
    const settingsSupportBtn = document.querySelector(
        '.settings-bottom-actions .settings-action-btn.primary span'
    );
    if (settingsSupportBtn && dict.settings_support) {
        settingsSupportBtn.textContent = dict.settings_support;
    }

    // Orders / Ads empty states
    const ordersEmpty = document.querySelector('#orders-modal .orders-empty-state');
    if (ordersEmpty) {
        const title = ordersEmpty.querySelector('h3');
        const text = ordersEmpty.querySelector('p');
        const btn = ordersEmpty.querySelector('.btn-primary');
        if (title && dict.orders_empty_title) title.textContent = dict.orders_empty_title;
        if (text && dict.orders_empty_text) text.textContent = dict.orders_empty_text;
        if (btn && dict.orders_empty_cta) btn.textContent = dict.orders_empty_cta;
    }

    const adsEmpty = document.querySelector('#active-ads-modal .orders-empty-state');
    if (adsEmpty) {
        const title = adsEmpty.querySelector('h3');
        const text = adsEmpty.querySelector('p');
        const btn = adsEmpty.querySelector('.btn-primary');
        if (title && dict.ads_empty_title) title.textContent = dict.ads_empty_title;
        if (text && dict.ads_empty_text) text.textContent = dict.ads_empty_text;
        if (btn && dict.ads_empty_cta) btn.textContent = dict.ads_empty_cta;
    }

    // Balance / payments
    const topupTitle = document.querySelector('#balance-topup-modal .topup-title');
    if (topupTitle && dict.topup_title) {
        topupTitle.textContent = dict.topup_title;
    }
    const topupDescription = document.querySelector(
        '#balance-topup-modal .topup-description'
    );
    if (topupDescription && dict.topup_description) {
        topupDescription.textContent = dict.topup_description;
    }
    const topupButton = document.querySelector(
        '#balance-topup-modal .topup-button.btn-primary'
    );
    if (topupButton && dict.topup_button) {
        topupButton.textContent = dict.topup_button;
    }
    const historyLink = document.querySelector(
        '#balance-topup-modal .payment-history-link'
    );
    if (historyLink && dict.topup_history_link) {
        historyLink.textContent = dict.topup_history_link;
    }

    // Chat page
    const chatTitle = document.querySelector('#chat-page .page-header h2');
    if (chatTitle && dict.chat_title) {
        chatTitle.textContent = dict.chat_title;
    }
    const chatSubtitle = document.querySelector('#chat-page .page-subtitle');
    if (chatSubtitle && dict.chat_subtitle) {
        chatSubtitle.textContent = dict.chat_subtitle;
    }
    const chatInput = document.getElementById('chat-message-input');
    if (chatInput && dict.chat_input_placeholder) {
        chatInput.placeholder = dict.chat_input_placeholder;
    }

    // Offer modal
    const offerCurrentPriceLabel = document.querySelector(
        '#offer-modal .offer-price-section label.input-label'
    );
    if (offerCurrentPriceLabel && dict.offer_current_price_label) {
        offerCurrentPriceLabel.textContent = dict.offer_current_price_label;
    }
    const offerSections = document.querySelectorAll(
        '#offer-modal .offer-price-section label.input-label'
    );
    if (offerSections[1] && dict.offer_your_price_label) {
        offerSections[1].textContent = dict.offer_your_price_label;
    }
    const offerPriceInput = document.getElementById('offer-price-input');
    if (offerPriceInput && dict.offer_price_placeholder) {
        offerPriceInput.placeholder = dict.offer_price_placeholder;
    }

    const offerButtons = document.querySelectorAll(
        '#offer-modal .offer-actions .btn-oval span'
    );
    if (offerButtons[0] && dict.common_back) {
        offerButtons[0].textContent = dict.common_back;
    }
    if (offerButtons[1] && dict.common_continue) {
        
        offerButtons[1].textContent = dict.common_continue;
    }

    // Purchase modal primary action (confirm / continue)
    const purchaseContinueBtn = document.querySelector(
        '#purchase-modal .purchase-actions .btn-primary'
    );
    if (purchaseContinueBtn && dict.common_continue) {
        setButtonLabelWithIcon(purchaseContinueBtn, dict.common_continue);
    }

    // Blogger detail modal actions
    const bloggerActions = document.querySelectorAll(
        '#blogger-detail-modal .blogger-modal-actions .blogger-modal-btn span'
    );
    if (bloggerActions[0] && dict.blogger_make_offer_btn) {
        bloggerActions[0].textContent = dict.blogger_make_offer_btn;
    }
    if (bloggerActions[1] && dict.blogger_buy_ad_btn) {
        bloggerActions[1].textContent = dict.blogger_buy_ad_btn;
    }

    // Post creation modal (step 2)
    const postCreationTitle = document.querySelector('.post-creation-title');
    if (postCreationTitle && dict.post_creation_title) {
        postCreationTitle.textContent = dict.post_creation_title;
    }
    const postCreationSubtitle = document.querySelector('.post-creation-subtitle');
    if (postCreationSubtitle && dict.post_creation_subtitle) {
        postCreationSubtitle.textContent = dict.post_creation_subtitle;
    }
    const postPlaceholder = document.querySelector('.post-creation-placeholder-text');
    if (postPlaceholder && dict.post_creation_placeholder_text) {
        postPlaceholder.textContent = dict.post_creation_placeholder_text;
    }
    const postTextarea = document.getElementById('post-creation-text');
    if (postTextarea && dict.post_creation_textarea_placeholder) {
        postTextarea.placeholder = dict.post_creation_textarea_placeholder;
    }
    const postError = document.getElementById('post-creation-text-error');
    if (postError && dict.post_creation_error_with_media) {
        // default with 950 as in initial HTML
        postError.textContent = dict.post_creation_error_with_media.replace(
            '{limit}',
            '950'
        );
    }

    // Post creation actions (Back / Continue)
    const postActions = document.querySelectorAll(
        '.post-creation-actions .btn-oval span, .post-creation-actions .btn-oval'
    );
    if (postActions[0] && dict.common_back) {
        postActions[0].textContent = dict.common_back;
    }
    if (postActions[1] && dict.common_continue) {
        postActions[1].textContent = dict.common_continue;
    }

    // Schedule / day picker titles & buttons (text only, icons stay)
    const scheduleTitle = document.querySelector('#schedule-modal .schedule-modal-title');
    if (scheduleTitle && dict.schedule_title) {
        scheduleTitle.textContent = dict.schedule_title;
    }
    const scheduleHint = document.querySelector('#schedule-modal .schedule-hint');
    if (scheduleHint && dict.schedule_hint) {
        scheduleHint.textContent = dict.schedule_hint;
    }
    const scheduleButtons = document.querySelectorAll(
        '#schedule-modal .schedule-actions .schedule-action-btn span'
    );
    if (scheduleButtons[0] && dict.schedule_cancel) {
        scheduleButtons[0].textContent = dict.schedule_cancel;
    }
    if (scheduleButtons[1] && dict.schedule_save) {
        scheduleButtons[1].textContent = dict.schedule_save;
    }

    const dayPickerTitle = document.querySelector('#day-picker-modal .day-picker-title');
    if (dayPickerTitle && dict.day_picker_title) {
        dayPickerTitle.textContent = dict.day_picker_title;
    }
    const dayPickerButtons = document.querySelectorAll(
        '#day-picker-modal .day-picker-actions .schedule-action-btn span'
    );
    if (dayPickerButtons[0] && dict.schedule_cancel) {
        dayPickerButtons[0].textContent = dict.schedule_cancel;
    }
    if (dayPickerButtons[1] && dict.schedule_save) {
        dayPickerButtons[1].textContent = dict.schedule_save;
    }
}

// Change language
function changeLanguage(lang) {
    console.log('🌐 changeLanguage called with:', lang);
    
    // Remove active class from all language buttons
    const languageBtns = document.querySelectorAll('.language-btn');
    languageBtns.forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to selected language
    const selectedBtn = document.querySelector(`.language-btn[data-lang="${lang}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    // Save language preference to localStorage
    localStorage.setItem('app_language', lang);
    
    // Apply language to UI (except bottom navigation, which stays in English)
    applyLanguage(lang);
    
    // Show notification
    const languageNames = {
        'ru': 'Русский',
        'uk': 'Українська',
        'en': 'English'
    };
    
    console.log('🔔 About to call showNotification for language change');
    showNotification(
        `Интерфейс изменен на ${languageNames[lang]}`, 
        'success', 
        'Язык изменен',
        3000
    );
    console.log('✅ showNotification called');
    
}

// Toggle FAQ item
function toggleFaq(button) {
    const faqItem = button.closest('.faq-item');
    const isOpen = faqItem.classList.contains('open');
    
    // Close all other FAQ items
    document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('open');
    });
    
    // Toggle current item
    if (!isOpen) {
        faqItem.classList.add('open');
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    // Re-initialize Lucide icons for the chevron animation
    setTimeout(() => {
        lucide.createIcons();
    }, 50);
}

// Open support
function openSupport() {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    // In a real app, this would open a support chat or link
    // For now, show a notification with support contact
    if (tg?.openTelegramLink) {
        tg.openTelegramLink('https://t.me/your_support_bot');
    } else {
        showNotification(
            'Напишите нам в Telegram: @support', 
            'info', 
            'Служба поддержки',
            4000
        );
    }
}

// Open FAQ
function openFAQ() {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    // Navigate to FAQ page
    closeSettingsModal();
    setTimeout(() => {
        showPage('faq');
    }, 300);
}

// Toggle vibration setting
function toggleVibration(toggle) {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    toggle.classList.toggle('active');
    
    const isActive = toggle.classList.contains('active');
    localStorage.setItem('vibration_enabled', isActive);
    
    if (isActive) {
        showNotification(
            'Вибрация будет срабатывать при нажатиях', 
            'success', 
            'Вибрация включена',
            3000
        );
    } else {
        showNotification(
            'Вибрация при нажатиях отключена', 
            'info', 
            'Вибрация выключена',
            3000
        );
    }
}

// Open Agreement Modal
function openAgreementModal() {
    // Close settings modal first
    closeSettingsModal();
    
    const overlay = document.getElementById('agreement-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (!overlay) return;
    
    // Show overlay + blur
    overlay.classList.add('active');
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.add('active');
    }
    
    // Initialize Lucide icons
    setTimeout(() => {
        lucide.createIcons();
    }, 50);
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

// Close Agreement Modal
function closeAgreementModal() {
    const overlay = document.getElementById('agreement-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (overlay) {
        overlay.classList.remove('active');
    }
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.remove('active');
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Open Privacy Modal
function openPrivacyModal() {
    // Close settings modal first
    closeSettingsModal();
    
    const overlay = document.getElementById('privacy-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (!overlay) return;
    
    // Show overlay + blur
    overlay.classList.add('active');
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.add('active');
    }
    
    // Initialize Lucide icons
    setTimeout(() => {
        lucide.createIcons();
    }, 50);
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

// Close Privacy Modal
function closePrivacyModal() {
    const overlay = document.getElementById('privacy-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (overlay) {
        overlay.classList.remove('active');
    }
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.remove('active');
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

// Toggle card status
async function toggleCardStatus(toggle) {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    toggle.classList.toggle('active');
    
    const isActive = toggle.classList.contains('active');
    localStorage.setItem('card_status_active', isActive);
    
    // Auto-save status
    try {
        const price12h = window.currentBloggerPrice || '0';
        const pricePermanent = window.currentBloggerPricePermanent || '';
        
        const response = await authenticatedFetch('/api/blogger/card/update', {
            method: 'POST',
            body: JSON.stringify({
                blogger_price_12h: price12h,
                blogger_price_permanent: pricePermanent,
                blogger_is_active: isActive
            })
        });
        
        if (response.ok) {
            if (isActive) {
                showNotification(
                    'Карточка активна и видна в поиске', 
                    'success', 
                    'Карточка активна',
                    3000
                );
            } else {
                showNotification(
                    'Карточка скрыта из поиска', 
                    'info', 
                    'Карточка скрыта',
                    3000
                );
            }
            
            // Refresh bloggers list
            loadBloggers();
        } else {
            throw new Error('Failed to update status');
        }
    } catch (error) {
        console.error('Error updating card status:', error);
        showNotification('Не удалось обновить статус', 'error', 'Ошибка');
        
        // Revert toggle state
        toggle.classList.toggle('active');
        localStorage.setItem('card_status_active', !isActive);
    }
}

// Load saved language preference on app start
function loadLanguagePreference() {
    const savedLang = localStorage.getItem('app_language') || 'ru';
    
    // Set active language button
    const languageBtns = document.querySelectorAll('.language-btn');
    languageBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.lang === savedLang) {
            btn.classList.add('active');
        }
    });

    // Apply saved language to UI (except bottom navigation, which stays in English)
    applyLanguage(savedLang);
}

// Close modals on Escape key (update to include blogger modal)
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeOrdersModal();
        closeActiveAdsModal();
        closeBloggerApplicationModal();
        closeBloggerModal();
        closeSettingsModal();
        closeBloggerCardModal();
        closeBalanceTopupModal();
    }
});

// ===== BLOGGER CARD MODAL FUNCTIONALITY =====

// Check blogger status and update button text
async function checkBloggerStatus() {
    console.log('🔍 checkBloggerStatus called');
    try {
        // Используем новый эндпоинт для получения списка каналов
        const response = await authenticatedFetch('/api/blogger/channels/list');
        
        if (!response.ok) {
            console.error('❌ Failed to check blogger status');
            return;
        }
        
        const data = await response.json();
        // Если есть каналы, значит пользователь - блогер
        currentUserIsBlogger = data.channels && data.channels.length > 0;
        
        console.log('👤 User is blogger:', currentUserIsBlogger);
        
        // Load channels in profile if user is blogger
        if (currentUserIsBlogger) {
            console.log('✅ User is blogger, loading profile channels...');
            await loadProfileChannels();
        } else {
            console.log('ℹ️ User is not a blogger, skipping channel load');
        }
    } catch (error) {
        console.error('❌ Error checking blogger status:', error);
    }
}

// Handle blogger link click
async function handleBloggerLinkClick() {
    // Всегда открываем модальное окно добавления канала
    // Не проверяем статус блогера - пользователь может добавить несколько каналов
    openBloggerApplicationModal();
}

// Open blogger card modal
async function openBloggerCardModal() {
    const modalOverlay = document.getElementById('blogger-card-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Add blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }
        
        // Load blogger card data
        await loadBloggerCard();
        
        // Load blogger channels
        if (typeof loadBloggerChannels === 'function') {
            await loadBloggerChannels();
        } else if (typeof window.loadBloggerChannels === 'function') {
            await window.loadBloggerChannels();
        }
        
        // Initialize Lucide icons for the modal
        setTimeout(() => {
            lucide.createIcons();
        }, 50);
        
        // Attach event listener to schedule button
        const attachScheduleListener = () => {
            const scheduleBtn = document.querySelector('.schedule-btn');
            if (scheduleBtn && !scheduleBtn._listenerAttached) {
                scheduleBtn._listenerAttached = true;
                scheduleBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Schedule button clicked!');
                    
                    // Directly call the function - it should be loaded by now
                    if (typeof window.openScheduleModal === 'function') {
                        window.openScheduleModal();
                    } else {
                        console.error('openScheduleModal function not found');
                        // Try to call it anyway in case it's defined but not visible
                        try {
                            openScheduleModal();
                        } catch (err) {
                            console.error('Failed to call openScheduleModal:', err);
                        }
                    }
                });
                console.log('Schedule button listener attached');
            }
            
            // Attach event listener to add channel button
            const addChannelBtns = document.querySelectorAll('.add-channel-btn');
            addChannelBtns.forEach(addChannelBtn => {
                if (addChannelBtn && !addChannelBtn._listenerAttached) {
                    addChannelBtn._listenerAttached = true;
                    addChannelBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('Add channel button clicked!');
                        
                        // Directly call the function - it should be loaded by now
                        if (typeof window.addNewChannel === 'function') {
                            window.addNewChannel();
                        } else {
                            console.error('addNewChannel function not found');
                            // Try to call it anyway in case it's defined but not visible
                            try {
                                addNewChannel();
                            } catch (err) {
                                console.error('Failed to call addNewChannel:', err);
                            }
                        }
                    });
                    console.log('Add channel button listener attached');
                }
            });
        };
        
        // Try to attach listeners with retry
        setTimeout(attachScheduleListener, 100);
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
    }
}

// Close blogger card modal
function closeBloggerCardModal() {
    const modalOverlay = document.getElementById('blogger-card-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        // Remove blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// Make function globally accessible
window.closeBloggerCardModal = closeBloggerCardModal;

// Load blogger card data
async function loadBloggerCard() {
    try {
        const response = await authenticatedFetch('/api/blogger/card');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to load blogger card');
        }
        
        const data = await response.json();
        
        console.log('Blogger card data received:', data);
        
        // Update modal with data
        const bloggerCardImg = document.getElementById('blogger-card-img');
        const bloggerPhotoPlaceholder = document.getElementById('blogger-photo-placeholder');
        const bloggerCardChannel = document.getElementById('blogger-card-channel');
        const bloggerCardSubscribers = document.getElementById('blogger-card-subscribers');
        const bloggerCardPrice = document.getElementById('blogger-card-price');
        const bloggerCardPricePermanent = document.getElementById('blogger-card-price-permanent');
        
        // Set photo
        if (data.blogger_photo_url) {
            bloggerCardImg.src = data.blogger_photo_url;
            bloggerCardImg.classList.add('active');
            bloggerPhotoPlaceholder.classList.add('hidden');
            
            // Handle image load error - show placeholder
            bloggerCardImg.onerror = function() {
                console.warn('Failed to load blogger photo:', data.blogger_photo_url);
                bloggerCardImg.classList.remove('active');
                bloggerPhotoPlaceholder.classList.remove('hidden');
            };
        } else {
            bloggerCardImg.classList.remove('active');
            bloggerPhotoPlaceholder.classList.remove('hidden');
        }
        
        // Set channel name with clickable link
        if (data.channel_username && data.channel_link) {
            bloggerCardChannel.innerHTML = `<a href="${data.channel_link}" target="_blank" class="channel-link">${data.channel_username}</a>`;
        } else if (userData && userData.username) {
            bloggerCardChannel.textContent = `@${userData.username}`;
        } else {
            bloggerCardChannel.textContent = '@channel';
        }
        
        // Format and set subscribers count
        const subscribersCount = data.blogger_subscribers || 0;
        const formattedSubscribers = formatNumber(subscribersCount);
        bloggerCardSubscribers.textContent = formattedSubscribers;
        
        console.log(`Formatted subscribers: ${subscribersCount} -> ${formattedSubscribers}`);
        
        // Set price for 12 hours
        const priceValue = data.blogger_price || '0';
        const cleanPrice = priceValue.replace(/₽/g, '').trim();
        
        // Set permanent price
        const pricePermanentValue = data.blogger_price_permanent || '';
        const cleanPricePermanent = pricePermanentValue.replace(/₽/g, '').trim();
        
        // Store current prices for editing
        window.currentBloggerPrice = cleanPrice;
        window.currentBloggerPricePermanent = cleanPricePermanent;
        
        // Display 12h price or placeholder
        if (cleanPrice === '0' || cleanPrice === '' || cleanPrice === '0.0') {
            bloggerCardPrice.innerHTML = '<span class="price-value">Укажите цену</span> <span class="price-label">/ 12 часов</span>';
            bloggerCardPrice.classList.add('placeholder');
        } else {
            bloggerCardPrice.innerHTML = `<span class="price-value">${cleanPrice} ₽</span> <span class="price-label">/ 12 часов</span>`;
            bloggerCardPrice.classList.remove('placeholder');
        }
        
        // Display permanent price or placeholder
        if (bloggerCardPricePermanent) {
            if (cleanPricePermanent === '' || cleanPricePermanent === '0' || cleanPricePermanent === '0.0') {
                bloggerCardPricePermanent.innerHTML = '<span class="price-value-permanent">Укажите цену</span> <span class="price-label">/ без удаления</span>';
                bloggerCardPricePermanent.classList.add('placeholder');
            } else {
                bloggerCardPricePermanent.innerHTML = `<span class="price-value-permanent">${cleanPricePermanent} ₽</span> <span class="price-label">/ без удаления</span>`;
                bloggerCardPricePermanent.classList.remove('placeholder');
            }
            
            // Add editable class
            bloggerCardPricePermanent.classList.add('editable');
        }
        
        // Add editable class
        bloggerCardPrice.classList.add('editable');
        
        // Set card status toggle based on DB value
        const statusToggle = document.getElementById('card-status-toggle');
        if (statusToggle) {
            // Use server value
            const isActive = data.blogger_is_active === true;
            
            if (isActive) {
                statusToggle.classList.add('active');
            } else {
                statusToggle.classList.remove('active');
            }
            
            // Update localStorage
            localStorage.setItem('card_status_active', isActive);
        }
        
    } catch (error) {
        console.error('Error loading blogger card:', error);
        showNotification('Не удалось загрузить данные карточки. Попробуйте еще раз.', 'error', 'Ошибка загрузки');
    }
}

// Edit price inline
function editPriceInline(priceType = '12h') {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    const priceRow = document.querySelector('.blogger-modal-price-row');
    const priceEdit = document.getElementById('blogger-card-price-edit');
    const priceInput = document.getElementById('blogger-price-inline-input');
    const labelText = document.getElementById('price-edit-label-text');
    
    if (!priceRow || !priceEdit || !priceInput) return;
    
    // Store which price we're editing
    window.editingPriceType = priceType;
    
    // Hide display, show edit
    priceRow.style.display = 'none';
    priceEdit.style.display = 'flex';
    
    // Set input value and label based on price type
    if (priceType === 'permanent') {
        priceInput.value = window.currentBloggerPricePermanent || '';
        if (labelText) labelText.textContent = '/ без удаления';
    } else {
        priceInput.value = window.currentBloggerPrice || '';
        if (labelText) labelText.textContent = '/ 12 часов';
    }
    
    // Focus input
    setTimeout(() => {
        priceInput.focus();
        priceInput.select();
    }, 100);
    
    // Re-initialize Lucide icons
    setTimeout(() => {
        lucide.createIcons();
    }, 50);
}

// Save price inline
async function savePriceInline() {
    const priceInput = document.getElementById('blogger-price-inline-input');
    const bloggerCardPrice = document.getElementById('blogger-card-price');
    const bloggerCardPricePermanent = document.getElementById('blogger-card-price-permanent');
    const priceEdit = document.getElementById('blogger-card-price-edit');
    
    if (!priceInput || !bloggerCardPrice || !priceEdit) return;
    
    const newPrice = priceInput.value.trim();
    const priceType = window.editingPriceType || '12h';
    
    if (!newPrice) {
        showNotification('Укажите цену', 'error', 'Ошибка');
        return;
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    // Show loading notification
    showNotification('Сохраняем цену...', 'info', 'Сохранение', 2000);
    
    try {
        // Get status from toggle
        const statusToggle = document.getElementById('card-status-toggle');
        const isActive = statusToggle ? statusToggle.classList.contains('active') : false;
        
        // Prepare data based on which price we're editing
        const updateData = {
            blogger_is_active: isActive
        };
        
        if (priceType === 'permanent') {
            updateData.blogger_price_12h = window.currentBloggerPrice || '0';
            updateData.blogger_price_permanent = newPrice;
        } else {
            updateData.blogger_price_12h = newPrice;
            updateData.blogger_price_permanent = window.currentBloggerPricePermanent || '';
        }
        
        const response = await authenticatedFetch('/api/blogger/card/update', {
            method: 'POST',
            body: JSON.stringify(updateData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update stored prices
            if (priceType === 'permanent') {
                window.currentBloggerPricePermanent = newPrice;
            } else {
                window.currentBloggerPrice = newPrice;
            }
            
            // Update display
            if (priceType === 'permanent') {
                if (newPrice === '0' || newPrice === '' || newPrice === '0.0') {
                    bloggerCardPricePermanent.innerHTML = '<span class="price-value-permanent">Укажите цену</span> <span class="price-label">/ без удаления</span>';
                    bloggerCardPricePermanent.classList.add('placeholder');
                } else {
                    bloggerCardPricePermanent.innerHTML = `<span class="price-value-permanent">${newPrice} ₽</span> <span class="price-label">/ без удаления</span>`;
                    bloggerCardPricePermanent.classList.remove('placeholder');
                }
            } else {
                if (newPrice === '0' || newPrice === '' || newPrice === '0.0') {
                    bloggerCardPrice.innerHTML = '<span class="price-value">Укажите цену</span> <span class="price-label">/ 12 часов</span>';
                    bloggerCardPrice.classList.add('placeholder');
                } else {
                    bloggerCardPrice.innerHTML = `<span class="price-value">${newPrice} ₽</span> <span class="price-label">/ 12 часов</span>`;
                    bloggerCardPrice.classList.remove('placeholder');
                }
            }
            
            // Hide edit, show display
            priceEdit.style.display = 'none';
            const priceRow = document.querySelector('.blogger-modal-price-row');
            if (priceRow) priceRow.style.display = 'flex';
            
            // Reload card to get updated subscribers count
            await loadBloggerCard();
            
            // Refresh bloggers list on main page
            loadBloggers();
            
            // Show success notification
            showNotification('Цена обновлена!', 'success', 'Успех');
            
            // Haptic feedback
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        } else {
            throw new Error(data.error || 'Update failed');
        }
    } catch (error) {
        console.error('Error saving price:', error);
        showNotification('Не удалось сохранить цену', 'error', 'Ошибка');
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }
    }
}

// Cancel price inline edit
function cancelPriceInline() {
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    const priceRow = document.querySelector('.blogger-modal-price-row');
    const priceEdit = document.getElementById('blogger-card-price-edit');
    
    if (!priceRow || !priceEdit) return;
    
    // Hide edit, show display
    priceEdit.style.display = 'none';
    priceRow.style.display = 'flex';
}

// Trigger photo upload
function triggerPhotoUpload() {
    const photoUpload = document.getElementById('blogger-photo-upload');
    if (photoUpload) {
        photoUpload.click();
    }
}

// Upload blogger photo
async function uploadBloggerPhoto(event) {
    const file = event.target.files[0];
    
    if (!file) {
        return;
    }
    
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showNotification('Размер файла не должен превышать 5 МБ', 'error', 'Файл слишком большой');
        return;
    }
    
    // Check file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        showNotification('Поддерживаются только изображения (PNG, JPG, GIF, WEBP)', 'error', 'Неверный формат');
        return;
    }
    
    // Show loading notification
    showNotification('Загружаем фото...', 'info', 'Загрузка', 2000);
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    try {
        // Create FormData
        const formData = new FormData();
        formData.append('photo', file);
        
        // Upload photo with custom fetch (FormData needs special handling)
        const response = await fetch('/api/blogger/photo/upload', {
            method: 'POST',
            headers: {
                'Authorization': `tma ${initDataRaw}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update image
            const bloggerCardImg = document.getElementById('blogger-card-img');
            const bloggerPhotoPlaceholder = document.getElementById('blogger-photo-placeholder');
            
            bloggerCardImg.src = data.photo_url;
            bloggerCardImg.classList.add('active');
            bloggerPhotoPlaceholder.classList.add('hidden');
            
            // Handle image load error
            bloggerCardImg.onerror = function() {
                console.warn('Failed to load uploaded photo:', data.photo_url);
                bloggerCardImg.classList.remove('active');
                bloggerPhotoPlaceholder.classList.remove('hidden');
            };
            
            // Show success notification
            showNotification('Фото успешно загружено!', 'success', 'Успех');
            
            // Haptic feedback
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Error uploading photo:', error);
        showNotification('Не удалось загрузить фото', 'error', 'Ошибка загрузки');
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }
    }
}

// Save blogger card
async function saveBloggerCard(event) {
    event.preventDefault();
    
    // Get current price from window variable
    const price = window.currentBloggerPrice || '0';
    
    // Get status from toggle
    const statusToggle = document.getElementById('card-status-toggle');
    const isActive = statusToggle ? statusToggle.classList.contains('active') : false;
    
    // Show loading notification
    showNotification('Сохраняем изменения...', 'info', 'Сохранение', 2000);
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    try {
        const response = await authenticatedFetch('/api/blogger/card/update', {
            method: 'POST',
            body: JSON.stringify({
                blogger_price: price,
                blogger_is_active: isActive
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Reload card to get updated subscribers count
            await loadBloggerCard();
            
            // Refresh bloggers list on main page (if we are on it or will go to it)
            loadBloggers();
            
            // Show success notification
            showNotification('Карточка блогера обновлена!', 'success', 'Успех');
            
            // Haptic feedback
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        } else {
            throw new Error(data.error || 'Update failed');
        }
    } catch (error) {
        console.error('Error saving blogger card:', error);
        showNotification('Не удалось сохранить изменения', 'error', 'Ошибка');
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }
    }
}

// ===== CHAT FUNCTIONALITY =====

// Global variable to store current chat blogger data
let currentChatBlogger = null;
let chatRefreshInterval = null;

// Open chat modal
async function openChatModal(bloggerData) {
    const modalOverlay = document.getElementById('chat-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (!modalOverlay) return;
    
    console.log('Opening chat with blogger data:', bloggerData); // DEBUG
    
    // Store blogger data
    currentChatBlogger = bloggerData;
    
    // Set blogger name and avatar in header
    const bloggerNameElement = document.getElementById('chat-blogger-name');
    const channelAvatarElement = document.getElementById('chat-channel-avatar');
    
    if (bloggerNameElement && bloggerData) {
        // Определяем, что показывать в зависимости от наличия buyer_name
        let displayName, displayAvatar;
        
        if (bloggerData.buyer_name && bloggerData.buyer_photo) {
            // Блогер видит имя и фото покупателя
            displayName = bloggerData.buyer_name;
            displayAvatar = bloggerData.buyer_photo;
            
            // Показываем аватарку канала справа
            if (channelAvatarElement && bloggerData.channel_avatar) {
                channelAvatarElement.src = bloggerData.channel_avatar;
                channelAvatarElement.style.display = 'block';
            }
        } else {
            // Покупатель видит имя и фото канала/блогера
            displayName = bloggerData.name || '@channel';
            displayAvatar = bloggerData.photo_url || bloggerData.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=2481cc&color=fff&size=48`;
            
            // Скрываем аватарку канала
            if (channelAvatarElement) {
                channelAvatarElement.style.display = 'none';
            }
        }
        
        console.log('Display name:', displayName, 'Display avatar:', displayAvatar); // DEBUG
        
        // Create avatar element
        const avatarImg = document.createElement('img');
        avatarImg.src = displayAvatar;
        avatarImg.className = 'chat-blogger-badge-avatar';
        avatarImg.alt = displayName;
        avatarImg.onerror = function() {
            console.error('Failed to load avatar:', displayAvatar); // DEBUG
            this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=2481cc&color=fff&size=48`;
        };
        
        // Clear and set content
        bloggerNameElement.innerHTML = '';
        bloggerNameElement.appendChild(avatarImg);
        bloggerNameElement.appendChild(document.createTextNode(displayName));
    }
    
    // Clear input
    const messageInput = document.getElementById('chat-message-input');
    if (messageInput) {
        messageInput.value = '';
    }
    
    // Show modal
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Add blur overlay
    if (pageBlurOverlay) {
        pageBlurOverlay.classList.add('active');
    }
    
    // Show Telegram BackButton
    if (tg?.BackButton) {
        tg.BackButton.show();
        tg.BackButton.onClick(closeChatModal);
    }
    
    // Сбрасываем последний ID сообщений для нового диалога
    lastChatMessageId = null;

    // Загружаем сообщения как первый рендер (будет красивая анимация старых сообщений)
    await loadChatMessages({ isInitialLoad: true });
    
    // Запускаем автообновление без "первой" анимации —
    // при нём будут анимироваться только реально новые сообщения
    chatRefreshInterval = setInterval(() => loadChatMessages({ isAutoRefresh: true }), 5000);
    
    // Initialize Lucide icons
    setTimeout(() => {
        lucide.createIcons();
    }, 50);
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    // Focus input
    setTimeout(() => {
        if (messageInput) {
            messageInput.focus();
        }
    }, 300);
}

// Close chat modal
function closeChatModal() {
    const modalOverlay = document.getElementById('chat-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        // Remove blur overlay
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        // Hide Telegram BackButton
        if (tg?.BackButton) {
            tg.BackButton.hide();
            tg.BackButton.offClick(closeChatModal);
        }
        
        // Stop auto-refresh
        if (chatRefreshInterval) {
            clearInterval(chatRefreshInterval);
            chatRefreshInterval = null;
        }

        // Clear current blogger
        currentChatBlogger = null;
        
        // Haptic feedback
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// ID последнего отрисованного сообщения, чтобы анимацию применять только к новым
let lastChatMessageId = null;

// Загрузка сообщений чата
// options:
// - isInitialLoad: true, когда чат открывается пользователем через кнопку (первый рендер)
// - isAutoRefresh: true, когда чат обновляется по таймеру, пока пользователь сидит в чате
async function loadChatMessages(options = {}) {
    const { isInitialLoad = false, isAutoRefresh = false } = options;
    if (!currentChatBlogger || !currentChatBlogger.user_id) {
        console.error('No blogger data available');
        return;
    }
    
    try {
        // Загружаем обычные сообщения с учетом channel_id
        const channelParam = currentChatBlogger.channel_id ? `?channel_id=${currentChatBlogger.channel_id}` : '';
        const response = await authenticatedFetch(`/api/chat/messages/${currentChatBlogger.user_id}${channelParam}`);
        
        console.log(`📥 Loading messages: blogger=${currentChatBlogger.user_id}, channel=${currentChatBlogger.channel_id || 'none'}`); // DEBUG
        
        if (!response.ok) {
            throw new Error('Failed to load messages');
        }
        
        const data = await response.json();
        const messagesContainer = document.getElementById('chat-messages');
        
        if (!messagesContainer) return;

        // Сохраняем состояние input перед обновлением
        const messageInput = document.getElementById('chat-message-input');
        const reviewInputs = document.querySelectorAll('.review-text-input');
        
        // Определяем активный элемент
        const activeElement = document.activeElement;
        const isMessageInputFocused = activeElement === messageInput;
        const isReviewInputFocused = activeElement && activeElement.classList.contains('review-text-input');
        const activeReviewId = isReviewInputFocused ? activeElement.closest('[data-review-id]')?.getAttribute('data-review-id') : null;
        
        // Сохраняем значения всех inputs
        const savedInputStates = new Map();
        if (messageInput) {
            savedInputStates.set('chat-message-input', {
                value: messageInput.value,
                selectionStart: messageInput.selectionStart,
                selectionEnd: messageInput.selectionEnd,
                isFocused: isMessageInputFocused
            });
        }
        reviewInputs.forEach((input, index) => {
            const reviewCard = input.closest('[data-review-id]');
            const reviewId = reviewCard ? reviewCard.getAttribute('data-review-id') : `review-${index}`;
            savedInputStates.set(reviewId, {
                value: input.value,
                selectionStart: input.selectionStart,
                selectionEnd: input.selectionEnd,
                isFocused: input === activeElement
            });
        });

        // Сохраняем текущую позицию скролла
        const currentScrollTop = messagesContainer.scrollTop;
        const currentScrollHeight = messagesContainer.scrollHeight;

        // Был ли пользователь внизу чата до обновления
        const wasAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop <= messagesContainer.clientHeight + 100;

        // Последний отрисованный ID сообщения до текущего обновления
        const previousLastMessageId = lastChatMessageId !== null ? Number(lastChatMessageId) : null;
        let newLastMessageId = previousLastMessageId;
        
        // Загружаем рекламные посты для этого чата (между текущим пользователем и собеседником)
        let adPosts = [];
        try {
            const chatPartnerId = currentChatBlogger.user_id;
            // NEW: Добавляем channel_id в запрос, если он есть
            const channelParam = currentChatBlogger.channel_id ? `?channel_id=${currentChatBlogger.channel_id}` : '';
            const postsResponse = await authenticatedFetch(`/api/ad_posts/chat/${chatPartnerId}${channelParam}`);
            if (postsResponse.ok) {
                const postsData = await postsResponse.json();
                adPosts = postsData.posts || [];
            }
        } catch (e) {
            console.error('Error loading ad posts:', e);
        }

        if ((data.messages && data.messages.length > 0) || adPosts.length > 0) {
            // Полностью перерисовываем чат, объединяя обычные сообщения и карточки постов по времени
            messagesContainer.innerHTML = '';

            const combinedItems = [];

            (data.messages || []).forEach(message => {
                combinedItems.push({
                    type: 'message',
                    createdAt: message.created_at,
                    data: message
                });
            });

            (adPosts || []).forEach(post => {
                // Для карточки поста используем created_at (момент оформления) либо scheduled_time как запасной вариант
                const createdAt = post.created_at || post.scheduled_time || post.updated_at;
                combinedItems.push({
                    type: 'ad_post',
                    createdAt,
                    data: post
                });
            });

            combinedItems.sort((a, b) => {
                const aTime = new Date(a.createdAt).getTime();
                const bTime = new Date(b.createdAt).getTime();
                return aTime - bTime;
            });

            combinedItems.forEach(item => {
                if (item.type === 'message') {
                    const msgId = Number(item.data.id);

                    // Анимация:
                    // - при первом открытии чата через кнопку — для всех сообщений
                    // - при автообновлении — только для реально новых сообщений
                    //   (у которых id больше последнего уже отрисованного)
                    let shouldAnimate = false;
                    if (isInitialLoad) {
                        shouldAnimate = true;
                    } else if (
                        isAutoRefresh &&
                        previousLastMessageId !== null &&
                        Number.isFinite(msgId) &&
                        msgId > previousLastMessageId
                    ) {
                        shouldAnimate = true;
                    }

                    renderChatMessage(item.data, shouldAnimate);
                    if (Number.isFinite(msgId)) {
                        if (newLastMessageId === null || msgId > newLastMessageId) {
                            newLastMessageId = msgId;
                        }
                    }
                } else if (item.type === 'ad_post') {
                    renderAdPostCard(item.data);
                }
            });

            if (newLastMessageId !== null) {
                lastChatMessageId = newLastMessageId;
            }

            // Восстанавливаем значения inputs И фокус если он был
            requestAnimationFrame(() => {
                // Восстанавливаем значение основного input
                const newMessageInput = document.getElementById('chat-message-input');
                if (newMessageInput && savedInputStates.has('chat-message-input')) {
                    const savedState = savedInputStates.get('chat-message-input');
                    newMessageInput.value = savedState.value;
                    // Восстанавливаем фокус ТОЛЬКО если он был (чтобы клавиатура не закрывалась)
                    if (savedState.isFocused) {
                        newMessageInput.focus();
                        if (savedState.selectionStart !== null && savedState.selectionEnd !== null) {
                            newMessageInput.setSelectionRange(savedState.selectionStart, savedState.selectionEnd);
                        }
                    }
                }
                
                // Восстанавливаем значения review inputs
                const newReviewInputs = document.querySelectorAll('.review-text-input');
                newReviewInputs.forEach(input => {
                    const reviewCard = input.closest('[data-review-id]');
                    const reviewId = reviewCard ? reviewCard.getAttribute('data-review-id') : null;
                    if (reviewId && savedInputStates.has(reviewId)) {
                        const savedState = savedInputStates.get(reviewId);
                        input.value = savedState.value;
                        // Восстанавливаем фокус ТОЛЬКО если он был
                        if (savedState.isFocused) {
                            input.focus();
                            if (savedState.selectionStart !== null && savedState.selectionEnd !== null) {
                                input.setSelectionRange(savedState.selectionStart, savedState.selectionEnd);
                            }
                        }
                        // Обновляем счетчик символов
                        const counter = reviewCard.querySelector('.current-count');
                        if (counter) {
                            counter.textContent = savedState.value.length;
                        }
                    }
                });
                
                // Управление скроллом: сохраняем позицию чтобы чат не прыгал
                if (wasAtBottom || isInitialLoad) {
                    // Только если был внизу - скроллим вниз
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                } else {
                    // Сохраняем позицию скролла - чат НЕ должен прыгать
                    const newScrollHeight = messagesContainer.scrollHeight;
                    const scrollDiff = newScrollHeight - currentScrollHeight;
                    if (scrollDiff > 0) {
                        // Компенсируем добавление новых сообщений сверху
                        messagesContainer.scrollTop = currentScrollTop + scrollDiff;
                    } else {
                        // Оставляем на той же позиции
                        messagesContainer.scrollTop = currentScrollTop;
                    }
                }
            });
        } else {
            // Показываем empty-state только при самом первом открытии чата руками,
            // но не при фоновых автообновлениях
            if (isInitialLoad && !isAutoRefresh) {
                messagesContainer.innerHTML = `
                    <div class="chat-empty-state">
                        <i data-lucide="message-circle"></i>
                        <p>Начните общение с блогером</p>
                    </div>
                `;
                lucide.createIcons();
            }
        }

    } catch (error) {
        console.error('Error loading chat messages:', error);
    }
}

// Flag to prevent double sending
let isSendingMessage = false;

// Render advertisement post card (grey card in chat)
function renderAdPostCard(post) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    const currentUserId = userData?.id || userData?.user_id;
    const isBuyer = Number(post.buyer_id) === Number(currentUserId);
    const isBlogger = Number(post.blogger_id) === Number(currentUserId);
    
    // Создаем контейнер для рекламной карточки
    const cardContainer = document.createElement('div');
    cardContainer.className = 'ad-post-card-container';
    cardContainer.setAttribute('data-post-id', post.id);
    
    // Парсим изображения
    let images = [];
    try {
        images = typeof post.post_images === 'string' ? JSON.parse(post.post_images) : (post.post_images || []);
    } catch (e) {
        images = [];
    }
    
    // Форматируем дату и время
    const scheduledDate = new Date(post.scheduled_time);
    const deleteDate = new Date(post.delete_time);
    const scheduledStr = scheduledDate.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
    const deleteStr = deleteDate.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Признак того, что заказ был оформлен как оффер (может прийти с бэкенда)
    const isOffer = !!post.is_offer;
    
    // Создаем HTML карточки
    let imagesHTML = '';
    if (images.length > 0) {
        imagesHTML = '<div class="ad-post-card-images">';
        images.forEach((imgUrl, index) => {
            if (index < 5) { // Показываем максимум 5 фото
                imagesHTML += `<img src="${imgUrl}" alt="Фото ${index + 1}" class="ad-post-card-image">`;
            }
        });
        if (images.length > 5) {
            imagesHTML += `<div class="ad-post-card-more-images">+${images.length - 5}</div>`;
        }
        imagesHTML += '</div>';
    }
    
    // Текущий статус из бэкенда
    const status = post.status || 'pending';

    // Текст и цвет статуса
    let statusText = '';
    let statusClass = '';

    if (status === 'pending') {
        if (isBuyer) {
            statusText = 'Вы оплатили этот пост';
        } else if (isBlogger) {
            statusText = 'Покупатель оплатил этот пост';
        } else {
            statusText = 'Пост оплачен';
        }
        statusClass = 'status-pending';
    } else if (status === 'approved') {
        statusText = 'В обработке';
        statusClass = 'status-processing';
    } else if (status === 'rejected') {
        statusText = 'Заказ отклонён';
        statusClass = 'status-rejected';
    } else if (status === 'cancelled') {
        statusText = 'Заказ отменён';
        statusClass = 'status-cancelled';
    } else {
        statusText = status;
        statusClass = 'status-pending';
    }
    
    // Кнопки действий
    let actionsHTML = '';
    // Кнопки доступны только пока заказ в ожидании (pending)
    if (status === 'pending') {
        if (isBuyer) {
            // Для покупателя — только кнопка отмены
            actionsHTML = `
                <button class="ad-post-card-btn cancel-order" onclick="cancelAdPost(${post.id})">
                    Отменить заказ
                </button>
            `;
        } else if (isBlogger) {
            // Для блогера — кнопки одобрения / отклонения
            actionsHTML = `
                <button class="ad-post-card-btn reject" onclick="rejectAdPost(${post.id})">
                    Отклонить
                </button>
                <button class="ad-post-card-btn approve" onclick="approveAdPost(${post.id})">
                    Одобрить
                </button>
            `;
        }
    }
    
    const priceLabelText = isOffer ? 'Предложенная цена:' : 'Стоимость:';
    const priceLabelClass = 'ad-post-card-info-label' + (isOffer ? ' offer-label' : '');
    const priceValueClass = 'ad-post-card-info-value' + (isOffer ? ' offer-price' : '');
    
    cardContainer.innerHTML = `
        <div class="ad-post-card">
            ${isOffer ? '<div class="ad-post-offer-badge">ОФФЕР</div>' : ''}
            ${imagesHTML}
            <div class="ad-post-card-text">${escapeHtml(post.post_text)}</div>
            <div class="ad-post-card-info">
                <div class="ad-post-card-info-row">
                    <span class="ad-post-card-info-label">Время поста:</span>
                    <span class="ad-post-card-info-value">${scheduledStr}</span>
                </div>
                <div class="ad-post-card-info-row">
                    <span class="ad-post-card-info-label">Удалить:</span>
                    <span class="ad-post-card-info-value">${deleteStr}</span>
                </div>
                <div class="ad-post-card-info-row">
                    <span class="${priceLabelClass}">${priceLabelText}</span>
                    <span class="${priceValueClass}">${post.price} ₽</span>
                </div>
                <div class="ad-post-card-info-row">
                    <span class="ad-post-card-info-label">Статус:</span>
                    <span class="ad-post-card-info-value ad-post-card-status ${statusClass}">${statusText}</span>
                </div>
            </div>
            <div class="ad-post-card-actions">
                ${actionsHTML}
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(cardContainer);
}

// Cancel ad post (buyer)
async function cancelAdPost(postId) {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    try {
        const response = await authenticatedFetch(`/api/ad_posts/${postId}/cancel`, {
            method: 'POST'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка при отмене заказа');
        }

        showNotification(data.message || 'Заказ отменён, средства возвращены', 'success');

        // Перезагружаем чат, чтобы обновить статусы и скрыть кнопки
        await loadChatMessages();
    } catch (error) {
        console.error('Error cancelling ad post:', error);
        showNotification(error.message || 'Ошибка при отмене заказа', 'error');
    }
}

// Approve ad post
async function approveAdPost(postId) {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    try {
        const response = await authenticatedFetch(`/api/ad_posts/${postId}/approve`, {
            method: 'POST'
        });
        
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка при одобрении поста');
        }
        
        showNotification(data.message || 'Пост одобрен!', 'success');

        // Перезагружаем чат, чтобы обновить статусы и скрыть кнопки
        await loadChatMessages();
        
    } catch (error) {
        console.error('Error approving ad post:', error);
        showNotification(error.message || 'Ошибка при одобрении поста', 'error');
    }
}

// Reject ad post
async function rejectAdPost(postId) {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    
    try {
        const response = await authenticatedFetch(`/api/ad_posts/${postId}/reject`, {
            method: 'POST'
        });
        
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка при отклонении поста');
        }
        
        showNotification(data.message || 'Пост отклонён, средства возвращены покупателю', 'success');

        // Перезагружаем чат, чтобы обновить статусы и скрыть кнопки
        await loadChatMessages();
        
    } catch (error) {
        console.error('Error rejecting ad post:', error);
        showNotification(error.message || 'Ошибка при отклонении поста', 'error');
    }
}

// Render a single chat message
function renderChatMessage(message, shouldAnimate = false) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    // Проверяем, является ли это системным сообщением с запросом на отзыв
    if (message.message_type === 'system_review' && message.metadata) {
        try {
            const metadata = typeof message.metadata === 'string' 
                ? JSON.parse(message.metadata) 
                : message.metadata;
            
            const currentUserId = userData?.id || userData?.user_id;
            
            // Показываем карточку только получателю сообщения
            if (Number(message.receiver_id) !== Number(currentUserId)) {
                return; // Не показываем эту карточку текущему пользователю
            }
            
            // Проверяем, не была ли уже отрисована эта карточка или уведомление
            const existingCard = messagesContainer.querySelector(`[data-review-id="${message.id}"]`);
            const existingNotification = messagesContainer.querySelector(`[data-notification-id="review-${message.id}"]`);
            if (existingCard || existingNotification) {
                return; // Карточка или уведомление уже есть, не добавляем повторно
            }
            
            // Если отзыв уже был оставлен, показываем серое сообщение
            if (metadata.review_submitted && metadata.submitted_rating) {
                console.log('✅ Rendering submitted review notification:', message.id, metadata);
                const reviewTypeText = metadata.review_type === 'blogger' ? 'блогере' : 'покупателе';
                const notificationElement = document.createElement('div');
                notificationElement.className = 'chat-message system-notification';
                notificationElement.setAttribute('data-notification-id', `review-${message.id}`);
                
                // Формируем заголовок и описание
                const title = `Отзыв отправлен`;
                let description = `Вы оставили отзыв о ${reviewTypeText} с оценкой ${metadata.submitted_rating} <span style="color: #fbbf24; font-size: 15px;">★</span>`;
                
                // Добавляем текст комментария, если он есть
                if (metadata.submitted_review_text && metadata.submitted_review_text.trim()) {
                    description += `<br><span style="margin-top: 4px; display: inline-block;">"${metadata.submitted_review_text}"</span>`;
                }
                
                notificationElement.innerHTML = `
                    <div class="system-notification-panel">
                        <div class="system-notification-title">${title}</div>
                        <div class="system-notification-description">${description}</div>
                    </div>
                `;
                
                messagesContainer.appendChild(notificationElement);
                return;
            }
            
            renderReviewRequest({
                id: message.id,
                post_id: metadata.post_id,
                buyer_id: message.receiver_id,
                blogger_id: message.sender_id,
                avatar_url: metadata.avatar_url,
                rating: metadata.rating || 0,
                review_type: metadata.review_type,
                target_user_id: metadata.target_user_id
            });
            return;
        } catch (e) {
            console.error('Error parsing review metadata:', e);
        }
    }
    
    // Проверяем, является ли это уведомлением об отзыве
    if (message.message_type === 'system_notification' && message.metadata) {
        try {
            const metadata = typeof message.metadata === 'string' 
                ? JSON.parse(message.metadata) 
                : message.metadata;
            
            const currentUserId = userData?.id || userData?.user_id;
            
            // Показываем уведомление только получателю
            if (Number(message.receiver_id) !== Number(currentUserId)) {
                return;
            }
            
            // Проверяем, не было ли уже отрисовано это уведомление
            const existingNotification = messagesContainer.querySelector(`[data-notification-id="${message.id}"]`);
            if (existingNotification) {
                return;
            }
            
            const notificationElement = document.createElement('div');
            notificationElement.className = 'chat-message system-notification';
            notificationElement.setAttribute('data-notification-id', message.id);
            
            // Формируем заголовок и описание
            const title = `Получен отзыв ${metadata.rating} <span style="color: #fbbf24; font-size: 16px;">★</span>`;
            let description = `${metadata.reviewer_type} оставил отзыв`;
            
            // Добавляем текст комментария, если он есть
            if (metadata.review_text && metadata.review_text.trim()) {
                description += `<br><span style="margin-top: 4px; display: inline-block;">"${metadata.review_text}"</span>`;
            }
            
            notificationElement.innerHTML = `
                <div class="system-notification-panel">
                    <div class="system-notification-title">${title}</div>
                    <div class="system-notification-description">${description}</div>
                </div>
            `;
            
            messagesContainer.appendChild(notificationElement);
            return;
        } catch (e) {
            console.error('Error parsing notification metadata:', e);
        }
    }
    
    const currentUserId = userData?.id || userData?.user_id;
    const isSent = Number(message.sender_id) === Number(currentUserId);
    
    // Проверяем, не было ли уже отрисовано это сообщение
    const existingMessage = messagesContainer.querySelector(`[data-message-id="${message.id}"]`);
    if (existingMessage) {
        return; // Сообщение уже есть, не добавляем повторно
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${isSent ? 'sent' : 'received'}${shouldAnimate ? ' chat-message-animated' : ''}`;
    messageElement.setAttribute('data-message-id', message.id);
    
    // Format time
    const messageDate = new Date(message.created_at);
    const timeString = messageDate.toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    messageElement.innerHTML = `
        <div class="message-bubble">
            ${escapeHtml(message.message)}
        </div>
        <div class="message-time">${timeString}</div>
    `;
    
    messagesContainer.appendChild(messageElement);
}

// Store review card states (selected ratings)
const reviewCardStates = {};

// Render review request component in chat
function renderReviewRequest(reviewData) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    // Проверяем, не существует ли уже эта карточка
    const existingCard = messagesContainer.querySelector(`[data-review-id="${reviewData.id}"]`);
    if (existingCard) {
        // Карточка уже существует, не пересоздаем её
        return;
    }
    
    const reviewElement = document.createElement('div');
    reviewElement.className = 'review-request-card';
    reviewElement.setAttribute('data-review-id', reviewData.id);
    reviewElement.setAttribute('data-post-id', reviewData.post_id);
    
    // Determine review text based on review type
    const currentUserId = userData?.id || userData?.user_id;
    const reviewText = reviewData.review_type === 'blogger' 
        ? 'Оставьте отзыв о блогере' 
        : 'Оставьте отзыв о покупателе';
    
    // Используем аватарку из currentChatBlogger (та же, что в шапке чата)
    let avatarUrl = reviewData.avatar_url || reviewData.photo_url;
    
    // Если отзыв о блогере, берем аватарку из currentChatBlogger (та же что сверху в чате)
    if (reviewData.review_type === 'blogger' && currentChatBlogger) {
        avatarUrl = currentChatBlogger.photo_url || currentChatBlogger.image || avatarUrl;
    }
    
    // Fallback на placeholder если аватарки нет
    if (!avatarUrl || avatarUrl === '/static/pic/default-avatar.png') {
        avatarUrl = `https://ui-avatars.com/api/?name=User&background=2481cc&color=fff&size=200`;
    }
    
    const rating = reviewData.rating || 0;
    
    // Check if we have saved state for this review card
    const savedState = reviewCardStates[reviewData.id];
    const selectedRating = savedState?.selectedRating || 0;
    const savedText = savedState?.reviewText || '';
    
    reviewElement.innerHTML = `
        <div class="review-avatar-wrapper">
            <img src="${avatarUrl}" alt="Avatar" class="review-avatar" onerror="this.src='https://ui-avatars.com/api/?name=User&background=2481cc&color=fff&size=200'">
            <div class="review-rating-badge">
                <span class="review-rating-value">${rating}</span>
                <svg class="review-rating-star" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
            </div>
        </div>
        <p class="review-request-text">${reviewText}</p>
        <div class="review-stars" data-target-user="${reviewData.target_user_id}" data-post-id="${reviewData.post_id}" data-review-type="${reviewData.review_type}">
            ${[1, 2, 3, 4, 5].map(star => `
                <svg class="review-star ${star <= selectedRating ? 'active' : ''}" data-rating="${star}" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
            `).join('')}
        </div>
        <div class="review-text-input-wrapper ${selectedRating > 0 ? 'visible' : ''}">
            <textarea 
                class="review-text-input" 
                placeholder="Напишите отзыв (необязательно)" 
                maxlength="50"
            >${savedText}</textarea>
            <div class="review-text-counter"><span class="current-count">${savedText.length}</span>/50</div>
        </div>
        <button class="review-submit-btn" ${selectedRating === 0 ? 'disabled' : ''}>Оставить отзыв</button>
    `;
    
    messagesContainer.appendChild(reviewElement);
    
    // Add event listeners for stars
    const stars = reviewElement.querySelectorAll('.review-star');
    const submitBtn = reviewElement.querySelector('.review-submit-btn');
    const textInputWrapper = reviewElement.querySelector('.review-text-input-wrapper');
    const textInput = reviewElement.querySelector('.review-text-input');
    const textCounter = reviewElement.querySelector('.current-count');
    let currentSelectedRating = selectedRating;
    let currentReviewText = savedText;
    
    // Text input handler
    if (textInput) {
        textInput.addEventListener('input', () => {
            currentReviewText = textInput.value;
            const length = currentReviewText.length;
            textCounter.textContent = length;
            
            // Save state
            reviewCardStates[reviewData.id] = {
                selectedRating: currentSelectedRating,
                reviewText: currentReviewText
            };
            
            // Warning color when approaching limit
            const counterParent = textCounter.parentElement;
            if (length >= 45) {
                counterParent.classList.add('warning');
            } else {
                counterParent.classList.remove('warning');
            }
        });
    }
    
    stars.forEach(star => {
        star.addEventListener('click', () => {
            const rating = parseInt(star.getAttribute('data-rating'));
            currentSelectedRating = rating;
            
            // Save state
            reviewCardStates[reviewData.id] = {
                selectedRating: rating,
                reviewText: currentReviewText
            };
            
            // Update star states
            stars.forEach((s, index) => {
                if (index < rating) {
                    s.classList.add('active');
                } else {
                    s.classList.remove('active');
                }
            });
            
            // Show text input and expand card
            if (!textInputWrapper.classList.contains('visible')) {
                textInputWrapper.classList.add('visible');
                reviewElement.classList.add('expanded');
            }
            
            // Enable submit button
            submitBtn.disabled = false;
            
            // Haptic feedback
            triggerVibration(20);
        });
    });
    
    // Submit review
    submitBtn.addEventListener('click', async () => {
        if (currentSelectedRating === 0) return;
        
        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Отправка...';
            
            const reviewType = reviewElement.querySelector('.review-stars').getAttribute('data-review-type');
            const postId = reviewElement.querySelector('.review-stars').getAttribute('data-post-id');
            const targetUserId = reviewElement.querySelector('.review-stars').getAttribute('data-target-user');
            
            const response = await fetch('/api/review/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `tma ${initDataRaw}`
                },
                body: JSON.stringify({
                    post_id: postId,
                    target_user_id: targetUserId,
                    rating: currentSelectedRating,
                    review_type: reviewType,
                    review_text: currentReviewText.trim()
                })
            });
            
            if (response.ok) {
                // Clear saved state
                delete reviewCardStates[reviewData.id];
                
                const responseData = await response.json();
                
                // Определяем текст в зависимости от типа отзыва
                const reviewTypeText = reviewType === 'blogger' ? 'блогере' : 'покупателе';
                
                // Формируем текст уведомления
                let notificationText = `Вы оставили отзыв о ${reviewTypeText} с оценкой ${currentSelectedRating} <span style="color: #fbbf24; font-size: 15px;">★</span>`;
                
                // Добавляем текст комментария, если он есть
                if (currentReviewText && currentReviewText.trim()) {
                    notificationText += `<br><br><span style="color: #9ca3af; font-size: 13px;">"${currentReviewText}"</span>`;
                }
                
                // Success - update UI с компактным сообщением в панельке
                reviewElement.className = 'chat-message system-notification';
                reviewElement.removeAttribute('data-review-id');
                reviewElement.setAttribute('data-notification-id', `review-${reviewData.id}`);
                
                const title = `Отзыв отправлен`;
                
                reviewElement.innerHTML = `
                    <div class="system-notification-panel">
                        <div class="system-notification-title">${title}</div>
                        <div class="system-notification-description">${notificationText}</div>
                    </div>
                `;
                
                showNotification('Отзыв отправлен', 'success');
                triggerVibration(30);
            } else {
                throw new Error('Failed to submit review');
            }
        } catch (error) {
            console.error('Error submitting review:', error);
            showNotification('Ошибка при отправке отзыва', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Оставить отзыв';
        }
    });
}

// Send chat message
async function sendChatMessage() {
    // Prevent double sending
    if (isSendingMessage) {
        console.log('Already sending a message, ignoring...');
        return;
    }
    
    const messageInput = document.getElementById('chat-message-input');
    const sendButton = document.querySelector('.chat-send-btn');
    
    if (!messageInput || !currentChatBlogger) return;
    
    const message = messageInput.value.trim();
    
    if (!message) {
        showNotification('Введите сообщение', 'warning', 'Пустое сообщение');
        return;
    }
    
    if (message.length > 250) {
        showNotification('Сообщение слишком длинное. Максимум 250 символов', 'warning', 'Ограничение длины');
        return;
    }

    // Small vibration when user sends a message
    triggerVibration(20);
    
    // Set sending flag and disable button
    isSendingMessage = true;
    if (sendButton) {
        sendButton.disabled = true;
        sendButton.style.opacity = '0.5';
    }
    
    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    
    try {
        const response = await authenticatedFetch('/api/chat/messages', {
            method: 'POST',
            body: JSON.stringify({
                blogger_id: currentChatBlogger.user_id,
                channel_id: currentChatBlogger.channel_id || null, // ДОБАВЛЕНО: channel_id
                message: message
            })
        });
        
        console.log(`📤 Sending message: blogger=${currentChatBlogger.user_id}, channel=${currentChatBlogger.channel_id || 'none'}`); // DEBUG
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to send message');
        }
        
        const data = await response.json();
        
        // Clear input
        messageInput.value = '';

        // После успешной отправки перезагружаем чат,
        // чтобы сообщение и карточки постов отобразились в единой хронологии
        await loadChatMessages();
        
        // Success haptic
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Не удалось отправить сообщение', 'error', 'Ошибка');
        
        // Error haptic
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('error');
        }
    } finally {
        // Разблокируем отправку сразу после завершения запроса
        isSendingMessage = false;
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.style.opacity = '1';
        }
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle Enter key in chat input
// Close chat modal on Escape
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeChatModal();
    }
});

// ===== CHATS LIST FUNCTIONALITY =====

// Флаг для предотвращения множественной загрузки
let isLoadingChats = false;

// Load chats list for Chat page
async function loadChatsList() {
    // Защита от множественных вызовов
    if (isLoadingChats) {
        console.log('Already loading chats, skipping...');
        return;
    }
    
    try {
        isLoadingChats = true;
        
        if (!initDataRaw) {
            console.error('No authentication data available');
            return;
        }
        
        const response = await authenticatedFetch('/api/chat/conversations');
        
        if (!response.ok) {
            throw new Error('Failed to load chats');
        }
        
        const data = await response.json();
        console.log('Loaded conversations:', data.conversations); // DEBUG
        
        const chatsList = document.getElementById('chats-list');
        
        if (!chatsList) return;
        
        // ИСПРАВЛЕНИЕ: Всегда очищаем список перед загрузкой, чтобы избежать дублирования
        chatsList.innerHTML = '';
        
        if (data.conversations && data.conversations.length > 0) {
            // ИСПРАВЛЕНИЕ: Убрали дедупликацию по user_id, теперь группируем по (user_id, channel_id)
            // Один блогер с несколькими каналами = несколько чатов
            
            data.conversations.forEach(conversation => {
                console.log('Conversation photo_url:', conversation.photo_url); // DEBUG
                
                const chatItem = document.createElement('div');
                chatItem.className = 'chat-item';
                if (conversation.unread_count > 0) {
                    chatItem.classList.add('unread');
                }
                
                // Format time
                const messageDate = new Date(conversation.last_message_time);
                const now = new Date();
                const isToday = messageDate.toDateString() === now.toDateString();
                const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === messageDate.toDateString();
                
                let timeString;
                if (isToday) {
                    timeString = messageDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                } else if (isYesterday) {
                    timeString = 'Вчера';
                } else {
                    timeString = messageDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
                }
                
                // Определяем, что показывать: для блогера - имя покупателя, для покупателя - username канала
                const displayName = conversation.buyer_name || conversation.name;
                const displayPhoto = conversation.buyer_photo || conversation.photo_url;
                
                // ИСПРАВЛЕНИЕ: Добавляем fallback для аватарки если photo_url пустой
                const avatarUrl = displayPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=2481cc&color=fff&size=200`;
                
                // Создаем HTML с аватаркой канала справа (только для блогера)
                let channelAvatarHtml = '';
                if (conversation.channel_avatar) {
                    channelAvatarHtml = `
                        <div class="chat-item-channel-avatar">
                            <img src="${conversation.channel_avatar}" alt="Канал" onerror="this.style.display='none'">
                        </div>
                    `;
                }
                
                chatItem.innerHTML = `
                    <div class="chat-item-avatar">
                        <img src="${avatarUrl}" alt="${displayName}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=2481cc&color=fff&size=200'">
                    </div>
                    <div class="chat-item-content">
                        <div class="chat-item-header">
                            <div class="chat-item-name">${escapeHtml(displayName)}</div>
                            ${channelAvatarHtml}
                            <div class="chat-item-time">${timeString}</div>
                        </div>
                        <div class="chat-item-footer">
                            <div class="chat-item-message">${escapeHtml(conversation.last_message || '')}</div>
                            ${conversation.unread_count > 0 ? `<div class="chat-item-badge">${conversation.unread_count}</div>` : ''}
                        </div>
                    </div>
                `;
                
                // Click handler to open chat
                chatItem.onclick = () => {
                    openChatWithUser({
                        user_id: conversation.user_id,
                        channel_id: conversation.channel_id || null, // ДОБАВЛЕНО: channel_id для разделения чатов
                        name: conversation.name,
                        photo_url: conversation.photo_url || avatarUrl,
                        image: conversation.photo_url || avatarUrl,
                        channel_link: conversation.channel_link,
                        buyer_name: conversation.buyer_name,  // NEW: Имя покупателя для блогера
                        buyer_photo: conversation.buyer_photo,  // NEW: Фото покупателя для блогера
                        channel_avatar: conversation.channel_avatar  // NEW: Аватарка канала для блогера
                    });
                };
                
                chatsList.appendChild(chatItem);
            });
        } else {
            // Show empty state
            chatsList.innerHTML = `
                <div class="chats-empty-state">
                    <div class="empty-icon">
                        <i data-lucide="message-circle"></i>
                    </div>
                    <h3>Нет чатов</h3>
                    <p>Начните общение с блогерами на странице Buy</p>
                    <button class="btn-primary" onclick="switchToPage('buy')">
                        <i data-lucide="search"></i>
                        Найти блогера
                    </button>
                </div>
            `;
            lucide.createIcons();
        }
    } catch (error) {
        console.error('Error loading chats list:', error);
    } finally {
        // Сбрасываем флаг загрузки
        isLoadingChats = false;
    }
}

// Open chat with specific user
function openChatWithUser(userData) {
    // Create blogger data object for chat modal
    const bloggerData = {
        user_id: userData.user_id,
        channel_id: userData.channel_id || null, // ДОБАВЛЕНО: channel_id для разделения чатов
        name: userData.name,
        photo_url: userData.photo_url || userData.image,
        image: userData.image || userData.photo_url,
        channel_link: userData.channel_link,
        buyer_name: userData.buyer_name,  // NEW: Имя покупателя для блогера
        buyer_photo: userData.buyer_photo,  // NEW: Фото покупателя для блогера
        channel_avatar: userData.channel_avatar  // NEW: Аватарка канала для блогера
    };
    
    console.log('📨 Opening chat from conversations list with channel_id:', bloggerData.channel_id); // DEBUG
    
    // Open chat modal
    openChatModal(bloggerData);
}

// Check URL parameters for direct chat opening
function checkChatParameter() {
    const urlParams = new URLSearchParams(window.location.search);
    const chatUserId = urlParams.get('chat');
    
    if (chatUserId) {
        // Load user data and open chat
        setTimeout(async () => {
            try {
                // Get conversations to find this user
                const response = await authenticatedFetch('/api/chat/conversations');
                if (response.ok) {
                    const data = await response.json();
                    const conversation = data.conversations.find(c => c.user_id == chatUserId);
                    
                    if (conversation) {
                        openChatWithUser({
                            user_id: conversation.user_id,
                            name: conversation.name,
                            photo_url: conversation.photo_url,
                            image: conversation.photo_url,
                            channel_link: conversation.channel_link
                        });
                    }
                }
            } catch (error) {
                console.error('Error opening chat from URL:', error);
            }
        }, 1000);
    }
}



// ===== PROFILE CHANNELS FUNCTIONALITY =====

// Load and display blogger channels in profile page
async function loadProfileChannels() {
    console.log('🔄 loadProfileChannels called! [VERSION 3.3 - NO LEGACY IF NEW CHANNELS EXIST]');
    try {
        // Try new channels API first
        const channelsResponse = await authenticatedFetch('/api/blogger/channels/list');
        const channelsData = await channelsResponse.json();
        
        console.log('📊 Profile channels response (new API):', channelsData);
        console.log('📊 Channels count (new API):', channelsData.channels ? channelsData.channels.length : 0);
        
        // Check if user has ANY channels in new system (even unverified)
        const hasNewChannels = channelsResponse.ok && channelsData.channels && channelsData.channels.length > 0;
        
        // FIXED: Show ALL channels from new system, not just verified ones
        // This ensures all channels are visible in profile
        let newChannels = [];
        if (hasNewChannels) {
            // Show all channels from new system
            newChannels = channelsData.channels;
            console.log(`✅ Found ${newChannels.length} channels in new system`);
        }
        
        // Combine channels from both sources
        let allChannels = [...newChannels];
        
        // ALWAYS check old blogger card API for legacy channel (backward compatibility)
        // This ensures the first channel from blogger_applications is always shown
        console.log('🔍 Checking old blogger card API for legacy channel...');
        const cardResponse = await authenticatedFetch('/api/blogger/card');
        const cardData = await cardResponse.json();
        
        console.log('📊 Blogger card response:', cardData);
        
        // If blogger has channel data in old format, add it to the list
        if (cardResponse.ok && cardData.is_blogger && cardData.channel_username) {
            console.log('✅ Found channel data in old format, checking if already in list...');
            
            // Check if this channel is already in the new channels list
            // Compare by channel_link AND channel_username to avoid false duplicates
            const legacyChannelLink = cardData.channel_link || '';
            const legacyChannelUsername = cardData.channel_username || '';
            
            const isDuplicate = newChannels.some(channel => {
                // Check if channel_link matches (if both are not empty)
                const linkMatches = legacyChannelLink !== '' && 
                                   channel.channel_link === legacyChannelLink;
                
                // Check if channel_name matches username (if both are not empty)
                const usernameMatches = legacyChannelUsername !== '' && 
                                       channel.channel_name === legacyChannelUsername;
                
                // Also check if channel_name contains the username without @
                const cleanUsername = legacyChannelUsername.replace('@', '');
                const nameContainsUsername = cleanUsername !== '' && 
                                            channel.channel_name && 
                                            channel.channel_name.includes(cleanUsername);
                
                return linkMatches || usernameMatches || nameContainsUsername;
            });
            
            if (!isDuplicate) {
                console.log('✅ Legacy channel not found in new channels, adding to list...');
                const legacyChannel = {
                    id: 0, // Legacy channel doesn't have ID
                    channel_name: cardData.channel_username,
                    channel_photo_url: cardData.blogger_photo_url || '',
                    subscribers_count: formatNumber(cardData.blogger_subscribers || 0),
                    topic_sub_title: cardData.topic_sub_title || 'Не указана',
                    price: cardData.blogger_price || '0',
                    channel_link: legacyChannelLink,
                    is_legacy: true // Mark as legacy to handle differently
                };
                
                // Add legacy channel to the beginning of the list
                allChannels.unshift(legacyChannel);
                console.log('✅ Added legacy channel to list');
            } else {
                console.log('⚠️ Legacy channel already exists in new channels, skipping');
            }
        }
        
        // Render all channels (new + legacy)
        if (allChannels.length > 0) {
            console.log(`✅ Rendering ${allChannels.length} total channels`);
            renderProfileChannels(allChannels);
        } else {
            console.log('⚠️ No channels to display in either API');
            // Hide section if no channels
            const section = document.getElementById('profile-channels-section');
            if (section) {
                section.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('❌ Error loading profile channels:', error);
        // Hide section on error
        const section = document.getElementById('profile-channels-section');
        if (section) {
            section.style.display = 'none';
        }
    }
}

// Render blogger channels in profile
function renderProfileChannels(channels) {
    console.log('🎨 renderProfileChannels called with channels:', channels);
    
    const section = document.getElementById('profile-channels-section');
    const feed = document.getElementById('profile-channels-feed');
    
    if (!section || !feed) {
        console.error('❌ Profile channels container not found');
        console.error('Section element:', section);
        console.error('Feed element:', feed);
        return;
    }
    
    console.log('✅ Found section and feed elements');
    
    // FORCE show section - remove inline style and set via JS
    section.style.display = 'block';
    section.style.visibility = 'visible';
    section.style.opacity = '1';
    console.log('✅ Section display FORCED to block');
    console.log('Section computed style:', window.getComputedStyle(section).display);
    
    // Clear feed
    feed.innerHTML = '';
    console.log('✅ Feed cleared');
    
    // If no channels, show message
    if (!channels || channels.length === 0) {
        console.log('⚠️ No channels to display');
        feed.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">Нет подключенных каналов</div>';
        return;
    }
    
    // Create channel cards using same structure as blogger cards on Buy page
    channels.forEach((channel, index) => {
        console.log(`🔨 Creating card ${index + 1} for channel:`, channel);
        
        // VALIDATION: Skip channels without proper identification
        // A channel must have at least channel_name, channel_link, or channel_id
        const hasChannelName = channel.channel_name && channel.channel_name.trim() !== '';
        const hasChannelLink = channel.channel_link && channel.channel_link.trim() !== '';
        const hasChannelId = channel.channel_id && channel.channel_id.trim() !== '';
        
        if (!hasChannelName && !hasChannelLink && !hasChannelId) {
            console.warn(`⚠️ Skipping channel ${channel.id} - no valid identification data`);
            return; // Skip this channel
        }
        
        // Use channel_name, or fallback to channel_link, or channel_id
        const displayName = channel.channel_name || 
                           channel.channel_link?.replace(/^https?:\/\/(t\.me|telegram\.me)\//, '@') || 
                           channel.channel_id || 
                           'Канал';
        
        console.log(`Channel ${channel.id} display name: "${displayName}"`);
        
        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'blogger-card-wrapper';
        cardWrapper.style.cursor = 'pointer';
        cardWrapper.dataset.channelId = channel.id; // Добавляем ID канала для удаления
        
        // Create card
        const card = document.createElement('div');
        card.className = 'blogger-card';
        
        // Avatar wrapper with photo
        const avatarWrapper = document.createElement('div');
        avatarWrapper.className = 'blogger-avatar-wrapper';
        
        const imageDiv = document.createElement('div');
        imageDiv.className = 'blogger-card-image';
        
        if (channel.channel_photo_url) {
            const img = document.createElement('img');
            img.src = channel.channel_photo_url;
            img.alt = displayName;
            img.className = 'blogger-photo';
            img.loading = 'lazy'; // Lazy loading for better mobile performance
            
            // Handle image load error - show placeholder
            img.onerror = function() {
                console.warn('Failed to load channel photo:', channel.channel_photo_url);
                img.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'blogger-photo-placeholder';
                placeholder.innerHTML = '<div class="blogger-photo-placeholder-inner"><i data-lucide="hash"></i></div>';
                imageDiv.appendChild(placeholder);
                if (window.lucide) lucide.createIcons();
            };
            
            imageDiv.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'blogger-photo-placeholder';
            placeholder.innerHTML = '<div class="blogger-photo-placeholder-inner"><i data-lucide="hash"></i></div>';
            imageDiv.appendChild(placeholder);
        }
        
        avatarWrapper.appendChild(imageDiv);
        
        // Content
        const content = document.createElement('div');
        content.className = 'blogger-card-content';
        
        // Header with name and subscribers
        const header = document.createElement('div');
        header.className = 'blogger-header';
        
        const channelName = document.createElement('h3');
        channelName.className = 'blogger-channel-name';
        channelName.textContent = displayName; // Use displayName (validated above)
        
        const headerRight = document.createElement('div');
        headerRight.className = 'blogger-header-right';
        
        const subscribers = document.createElement('span');
        subscribers.className = 'blogger-subscribers';
        subscribers.textContent = formatNumber(channel.subscribers_count || 0);
        
        headerRight.appendChild(subscribers);
        header.appendChild(channelName);
        header.appendChild(headerRight);
        
        // Topic
        const topic = document.createElement('div');
        topic.className = 'blogger-topic';
        topic.textContent = channel.topic_sub_title || 'Без тематики';
        
        content.appendChild(header);
        content.appendChild(topic);
        
        // Price
        const price = document.createElement('div');
        price.className = 'blogger-price';
        const priceValue = channel.price || '0';
        const cleanPrice = priceValue.replace(/₽/g, '').trim();
        price.textContent = cleanPrice === '0' ? 'Не указана' : `${cleanPrice}₽`;
        
        // Assemble card
        card.appendChild(avatarWrapper);
        card.appendChild(content);
        card.appendChild(price);
        
        cardWrapper.appendChild(card);
        
        // Click handler to open channel settings modal
        cardWrapper.addEventListener('click', () => {
            console.log('🖱️ Channel card clicked:', channel);
            
            // Check if this is a legacy channel (from old API)
            if (channel.is_legacy) {
                console.log('📜 Legacy channel detected, opening blogger card modal');
                // Open old blogger card modal
                if (typeof openBloggerCardModal === 'function') {
                    openBloggerCardModal();
                } else if (typeof window.openBloggerCardModal === 'function') {
                    window.openBloggerCardModal();
                } else {
                    console.error('❌ openBloggerCardModal function not found');
                }
            } else {
                console.log('🆕 New channel detected, opening channel detail modal');
                // Open new channel detail modal
                if (typeof openChannelDetailModal === 'function') {
                    openChannelDetailModal(channel.id);
                } else if (typeof window.openChannelDetailModal === 'function') {
                    window.openChannelDetailModal(channel.id);
                } else {
                    console.error('❌ openChannelDetailModal function not found');
                }
            }
            
            // Haptic feedback
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
            }
        });
        
        feed.appendChild(cardWrapper);
        console.log(`✅ Card ${index + 1} added to feed`);
    });
    
    console.log('✅ All cards rendered, total:', channels.length);
    console.log('Feed innerHTML length:', feed.innerHTML.length);
    console.log('Feed children count:', feed.children.length);
    
    // Initialize Lucide icons
    setTimeout(() => {
        if (window.lucide) {
            lucide.createIcons();
            console.log('✅ Lucide icons initialized');
        }
    }, 50);
}

// Make function globally accessible
window.loadProfileChannels = loadProfileChannels;

// ===== WALLET MODAL FUNCTIONS =====

// Convert raw address to user-friendly format
async function convertToUserFriendlyAddress(rawAddress) {
    try {
        // Проверяем, это raw-адрес или уже user-friendly
        if (!rawAddress.includes(':')) {
            // Уже user-friendly формат
            return rawAddress;
        }
        
        console.log('🔄 Начало конвертации адреса:', rawAddress);
        console.log('🔍 TonCore доступен:', typeof window.TonCore !== 'undefined');
        
        // Пробуем использовать библиотеку @ton/core если доступна
        if (typeof window.TonCore !== 'undefined' && window.TonCore.Address) {
            try {
                const Address = window.TonCore.Address;
                const addr = Address.parse(rawAddress);
                const userFriendly = addr.toString({ bounceable: true, testOnly: false });
                console.log('✅ Конвертация через TonCore:', rawAddress, '→', userFriendly);
                return userFriendly;
            } catch (e) {
                console.warn('⚠️ Ошибка конвертации через TonCore:', e);
            }
        }
        
        console.log('⚠️ TonCore недоступен, используем ручную конвертацию');
        
        // Fallback: ручная конвертация с правильным CRC
        const parts = rawAddress.split(':');
        if (parts.length !== 2) {
            return rawAddress;
        }
        
        const workchain = parseInt(parts[0]);
        const addressHex = parts[1];
        
        // Конвертируем hex в bytes
        const addressBytes = [];
        for (let i = 0; i < addressHex.length; i += 2) {
            addressBytes.push(parseInt(addressHex.substr(i, 2), 16));
        }
        
        // Создаем массив для user-friendly адреса
        // 0x11 = bounceable (UQ), 0x51 = non-bounceable (EQ)
        const tag = 0x11; // bounceable для UQ
        const addr = new Uint8Array([tag, workchain, ...addressBytes]);
        
        // Вычисляем CRC16 (XMODEM)
        const crc = crc16(addr);
        const addrWithCrc = new Uint8Array([...addr, crc >> 8, crc & 0xff]);
        
        // Конвертируем в base64
        let binary = '';
        for (let i = 0; i < addrWithCrc.length; i++) {
            binary += String.fromCharCode(addrWithCrc[i]);
        }
        const base64 = btoa(binary);
        
        // Делаем URL-safe
        const userFriendly = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        
        console.log('✅ Конвертация адреса (ручная):', rawAddress, '→', userFriendly);
        
        return userFriendly;
    } catch (error) {
        console.error('❌ Ошибка конвертации адреса:', error);
        return rawAddress;
    }
}

// CRC16 для TON адресов (XMODEM полином)
function crc16(data) {
    const poly = 0x1021;
    let crc = 0;
    
    for (let i = 0; i < data.length; i++) {
        crc ^= (data[i] << 8);
        
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ poly) : (crc << 1);
        }
    }
    
    return crc & 0xFFFF;
}

// Open wallet modal
function openWalletModal() {
    // Закрываем модальное окно пополнения
    closeBalanceTopupModal();
    
    // Небольшая задержка для плавности
    setTimeout(() => {
        const modalOverlay = document.getElementById('wallet-modal-overlay');
        const pageBlurOverlay = document.getElementById('page-blur-overlay');

        if (modalOverlay) {
            modalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';

            if (pageBlurOverlay) {
                pageBlurOverlay.classList.add('active');
            }

            // Проверяем статус подключения кошелька
            updateWalletModalState();

            if (tg?.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('medium');
            }
            
            // Инициализируем иконки Lucide
            setTimeout(() => {
                if (window.lucide) {
                    window.lucide.createIcons();
                }
            }, 100);
        }
    }, 300);
}

// Close wallet modal
function closeWalletModal() {
    const modalOverlay = document.getElementById('wallet-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';

        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// Update wallet modal state based on connection
async function updateWalletModalState() {
    const connectedState = document.getElementById('wallet-connected-state');
    const disconnectedState = document.getElementById('wallet-disconnected-state');
    
    if (!connectedState || !disconnectedState) {
        console.error('Wallet modal elements not found');
        return;
    }
    
    try {
        console.log('🔍 Проверка состояния кошелька...');
        
        // Проверяем, инициализирован ли TON Connect
        if (!window.tonPaymentManager) {
            console.log('⏳ TON Payment Manager не инициализирован, ждем...');
            
            // Ждем до 3 секунд
            for (let i = 0; i < 30; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                if (window.tonPaymentManager) {
                    console.log('✅ TON Payment Manager инициализирован');
                    break;
                }
            }
            
            if (!window.tonPaymentManager) {
                console.log('❌ TON Payment Manager не инициализирован после ожидания');
                connectedState.style.display = 'none';
                disconnectedState.style.display = 'flex';
                return;
            }
        }
        
        // Ждем готовности TON Connect
        console.log('⏳ Ожидание готовности TON Connect...');
        await window.tonPaymentManager.waitForReady();
        console.log('✅ TON Connect готов');
        
        // Дополнительная задержка для загрузки состояния кошелька
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Обновляем состояние подключения
        window.tonPaymentManager.updateConnectionState();
        
        // Выводим отладочную информацию (без циклических ссылок)
        console.log('🔍 isConnected:', window.tonPaymentManager.isConnected);
        
        // Получаем адрес кошелька
        let walletAddress = window.tonPaymentManager.getWalletAddress();
        console.log('🔍 getWalletAddress():', walletAddress);
        
        console.log('🔍 Итоговый адрес кошелька:', walletAddress);
        
        if (walletAddress) {
            // Кошелек подключен
            // Конвертируем в user-friendly формат
            const userFriendlyAddress = await convertToUserFriendlyAddress(walletAddress);
            
            // Показываем user-friendly адрес
            document.getElementById('wallet-address-text').textContent = userFriendlyAddress;
            
            // Сохраняем user-friendly адрес в data-атрибут для копирования
            document.getElementById('wallet-address-field').dataset.fullAddress = userFriendlyAddress;
            
            connectedState.style.display = 'flex';
            disconnectedState.style.display = 'none';
            
            console.log('✅ Кошелек подключен:', userFriendlyAddress);
        } else {
            // Кошелек не подключен
            connectedState.style.display = 'none';
            disconnectedState.style.display = 'flex';
            
            console.log('❌ Кошелек не подключен');
        }
    } catch (error) {
        console.error('❌ Ошибка обновления состояния кошелька:', error);
        connectedState.style.display = 'none';
        disconnectedState.style.display = 'flex';
    }
}

// Connect TON wallet
async function connectTonWallet() {
    try {
        if (!window.tonPaymentManager) {
            showNotification('TON Connect загружается, подождите...', 'warning');
            return;
        }
        
        // Ждем готовности
        await window.tonPaymentManager.waitForReady();
        
        showNotification('Подключение кошелька...', 'info');
        
        // Подключаем кошелек
        await window.tonPaymentManager.connectWallet();
        
        // Обновляем флаг подключения
        window.tonPaymentManager.isConnected = true;
        
        showNotification('Кошелек успешно подключен!', 'success');
        
        // Обновляем состояние модального окна
        await updateWalletModalState();
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
    } catch (error) {
        console.error('Ошибка подключения кошелька:', error);
        
        let errorMessage = 'Ошибка подключения кошелька';
        
        if (error.message.includes('User rejects') || error.message.includes('rejected')) {
            errorMessage = 'Подключение отменено';
        } else if (error.message.includes('Таймаут')) {
            errorMessage = 'Превышено время ожидания';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        showNotification(errorMessage, 'error');
    }
}

// Disconnect TON wallet
async function disconnectTonWallet() {
    try {
        if (!window.tonPaymentManager || !window.tonPaymentManager.tonConnectUI) {
            showNotification('TON Connect не инициализирован', 'error');
            return;
        }
        
        // Отключаем кошелек
        await window.tonPaymentManager.tonConnectUI.disconnect();
        
        // Обновляем флаг подключения
        window.tonPaymentManager.isConnected = false;
        
        showNotification('Кошелек отключен', 'success');
        
        // Обновляем состояние модального окна
        await updateWalletModalState();
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
    } catch (error) {
        console.error('Ошибка отключения кошелька:', error);
        showNotification('Ошибка отключения кошелька', 'error');
    }
}

// Handle wallet withdraw (placeholder)
async function handleWalletWithdraw() {
    try {
        // Проверяем, является ли пользователь блогером
        const userProfile = await fetch('/api/user/profile', {
            method: 'GET',
            headers: {
                'Authorization': `tma ${window.Telegram.WebApp.initData}`
            }
        });
        
        if (!userProfile.ok) {
            showNotification('Ошибка загрузки профиля', 'error');
            return;
        }
        
        const userData = await userProfile.json();
        
        // Проверяем тип пользователя
        if (userData.user_type !== 'blogger') {
            showNotification('Вывод доступен только для блогеров', 'warning');
            return;
        }
        
        // Получаем адрес кошелька
        const walletAddress = window.tonPaymentManager?.getWalletAddress();
        if (!walletAddress) {
            showNotification('Кошелек не подключен', 'error');
            return;
        }
        
        // Конвертируем в user-friendly формат
        const userFriendlyAddress = await convertToUserFriendlyAddress(walletAddress);
        
        // Закрываем модальное окно кошелька
        closeWalletModal();
        
        // Небольшая задержка для плавности
        setTimeout(() => {
            // Открываем модальное окно вывода
            openWithdrawModal(userData.balance, userFriendlyAddress);
        }, 300);
        
    } catch (error) {
        console.error('❌ Ошибка открытия окна вывода:', error);
        showNotification('Ошибка открытия окна вывода', 'error');
    }
}

// Open withdraw modal
function openWithdrawModal(balance, walletAddress) {
    const modalOverlay = document.getElementById('withdraw-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        // Устанавливаем баланс
        document.getElementById('withdraw-balance-amount').textContent = balance.toFixed(2);
        
        // Устанавливаем адрес кошелька
        document.getElementById('withdraw-wallet-address').value = walletAddress;
        
        // Очищаем поле суммы
        document.getElementById('withdraw-amount-input').value = '';
        
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.add('active');
        }
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
        
        // Инициализируем иконки Lucide
        setTimeout(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }, 100);
    }
}

// Close withdraw modal
function closeWithdrawModal() {
    const modalOverlay = document.getElementById('withdraw-modal-overlay');
    const pageBlurOverlay = document.getElementById('page-blur-overlay');
    
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        if (pageBlurOverlay) {
            pageBlurOverlay.classList.remove('active');
        }
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

// Submit withdraw request
async function submitWithdrawRequest() {
    try {
        const amountInput = document.getElementById('withdraw-amount-input');
        const walletAddress = document.getElementById('withdraw-wallet-address').value;
        const amount = parseFloat(amountInput.value);
        
        // Валидация
        if (!amount || amount <= 0) {
            showNotification('Введите корректную сумму', 'error');
            return;
        }
        
        if (!walletAddress) {
            showNotification('Адрес кошелька не указан', 'error');
            return;
        }
        
        // Получаем текущий баланс
        const balanceText = document.getElementById('withdraw-balance-amount').textContent;
        const balance = parseFloat(balanceText);
        
        if (amount > balance) {
            showNotification('Недостаточно средств', 'error');
            return;
        }
        
        // Показываем загрузку
        const submitBtn = document.querySelector('.withdraw-btn.btn-primary');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправка...';
        
        // Отправляем запрос на сервер
        const response = await fetch('/api/payment/withdraw/request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `tma ${window.Telegram.WebApp.initData}`
            },
            body: JSON.stringify({
                amount: amount,
                wallet_address: walletAddress
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка создания запроса на вывод');
        }
        
        const data = await response.json();
        
        // Успешно
        showNotification('Запрос на вывод отправлен администратору', 'success');
        
        // Закрываем модальное окно
        closeWithdrawModal();
        
        // Обновляем баланс
        await loadUserProfile();
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
        
    } catch (error) {
        console.error('❌ Ошибка создания запроса на вывод:', error);
        showNotification(error.message || 'Ошибка создания запроса на вывод', 'error');
    } finally {
        // Восстанавливаем кнопку
        const submitBtn = document.querySelector('.withdraw-btn.btn-primary');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Подтвердить';
        }
    }
}

// Copy wallet address to clipboard
function copyWalletAddress() {
    const addressField = document.getElementById('wallet-address-field');
    const fullAddress = addressField?.dataset.fullAddress;
    
    if (!fullAddress) {
        showNotification('Адрес не найден', 'error');
        return;
    }
    
    // Копируем в буфер обмена
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullAddress)
            .then(() => {
                showNotification('Адрес скопирован', 'success');
                
                if (tg?.HapticFeedback) {
                    tg.HapticFeedback.notificationOccurred('success');
                }
            })
            .catch(err => {
                console.error('Ошибка копирования:', err);
                fallbackCopyAddress(fullAddress);
            });
    } else {
        // Fallback для старых браузеров
        fallbackCopyAddress(fullAddress);
    }
}

// Fallback copy method
function fallbackCopyAddress(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
        document.execCommand('copy');
        showNotification('Адрес скопирован', 'success');
        
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
    } catch (err) {
        console.error('Ошибка копирования:', err);
        showNotification('Не удалось скопировать адрес', 'error');
    }
    
    document.body.removeChild(textArea);
}
