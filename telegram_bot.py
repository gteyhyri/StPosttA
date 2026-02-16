import asyncio
import logging
import os
import sqlite3
import re
import json
import requests
from datetime import datetime, timezone, timedelta

# Загрузка переменных окружения из .env файла
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv не установлен, используем системные переменные

from aiogram import Bot, Dispatcher, F, BaseMiddleware
from aiogram.filters import Command
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ChatMemberUpdated,
    WebAppInfo,
    InputMediaPhoto,
    FSInputFile,
)
from aiogram.filters.chat_member_updated import ChatMemberUpdatedFilter, MEMBER, ADMINISTRATOR, KICKED, LEFT, RESTRICTED
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from typing import Callable, Dict, Any, Awaitable
from database.db import init_db

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.FileHandler('bot.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'ТУТтокен')
ADMIN_ID = 6870552881
DATABASE_PATH = 'users.db'

MOSCOW_TZ = timezone(timedelta(hours=3))

TOPIC_GROUPS = {
    "news_media": {
        "title": "🔷 Новости и медиа",
        "subtopics": [
            ("world_news", "Новости мира"),
            ("city_news", "Новости городов"),
            ("economy_news", "Экономические новости"),
            ("entertainment_news", "Развлекательные новости"),
        ],
    },
    "business_finance": {
        "title": "🔷 Бизнес и финансы",
        "subtopics": [
            ("personal_finance", "Личные финансы"),
            ("investments", "Инвестиции"),
            ("trading", "Трейдинг"),
            ("crypto", "Криптовалюты"),
            ("real_estate", "Недвижимость"),
            ("entrepreneurship", "Предпринимательство"),
            ("marketing_ads", "Маркетинг и реклама"),
        ],
    },
    "education": {
        "title": "🔷 Образование",
        "subtopics": [
            ("courses", "Курсы и обучение"),
            ("exams", "ЕГЭ/ОГЭ"),
            ("languages", "Иностранные языки"),
            ("it_education", "IT-образование"),
            ("psychology", "Психология"),
            ("science_pop", "Научно-популярный контент"),
        ],
    },
    "technology": {
        "title": "🔷 Технологии",
        "subtopics": [
            ("it_news", "IT новости"),
            ("dev", "Разработка"),
            ("gadgets", "Гаджеты"),
            ("ai", "Искусственный интеллект"),
            ("cybersec", "Кибербезопасность"),
        ],
    },
    "fun": {
        "title": "🔷 Юмор и развлечения",
        "subtopics": [
            ("memes", "Мемы"),
            ("jokes", "Приколы"),
            ("entertainment_content", "Развлекательный контент"),
            ("stories", "Истории, рассказы"),
        ],
    },
    "literature": {
        "title": "🔷 Литература и творчество",
        "subtopics": [
            ("author_texts", "Авторские тексты"),
            ("writers", "Писатели, поэты"),
            ("fanfiction", "Фанфикшн"),
            ("illustrations", "Иллюстрации"),
        ],
    },
    "lifestyle": {
        "title": "🔷 Лайфстайл",
        "subtopics": [
            ("self_growth", "Саморазвитие"),
            ("motivation", "Мотивация"),
            ("relationship_psychology", "Психология отношений"),
            ("fashion", "Мода"),
            ("style", "Стиль"),
            ("travel", "Путешествия"),
        ],
    },
    "health": {
        "title": "🔷 Здоровье",
        "subtopics": [
            ("sport", "Спорт"),
            ("nutrition", "Питание"),
            ("healthy_life", "Здоровый образ жизни"),
            ("medicine", "Медицина"),
        ],
    },
    "gaming": {
        "title": "🔷 Игры и гейминг",
        "subtopics": [
            ("mobile_games", "Мобильные игры"),
            ("pc_console", "ПК и консоли"),
            ("guides_reviews", "Гайды, читы, обзоры"),
        ],
    },
    "hobbies": {
        "title": "🔷 Хобби",
        "subtopics": [
            ("music", "Музыка"),
            ("movies", "Фильмы"),
            ("anime", "Аниме"),
            ("auto_moto", "Авто/мото"),
        ],
    },
}


def _resolve_photo_input(path: str):
    """
    Преобразовать сохранённый путь к картинке в то, что понимает Telegram:
    - если это http/https URL — вернуть как есть
    - если это относительный путь (/static/...) — открыть локальный файл через FSInputFile
    """
    if not path:
        return None

    path = path.strip()

    if path.startswith("http://") or path.startswith("https://"):
        return path

    base_dir = os.path.dirname(os.path.abspath(__file__))
    local_path = os.path.join(base_dir, path.lstrip("/"))

    if not os.path.exists(local_path):
        logger.warning(f"⚠️ Image file not found on disk: {local_path} (original path: {path})")
        return None

    return FSInputFile(local_path)

bot = Bot(token=BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

class RejectionStates(StatesGroup):
    waiting_for_reason = State()

class ProfileEditStates(StatesGroup):
    waiting_for_balance = State()
    waiting_for_username = State()

class PremiumPostStates(StatesGroup):
    waiting_for_post_content = State()


def get_db_connection():
    """Создать подключение к базе данных"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def dict_from_row(row):
    """Преобразовать строку БД в словарь"""
    return {key: row[key] for key in row.keys()}

def get_admin_keyboard(application_id: int) -> InlineKeyboardMarkup:
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="✅ Одобрить",
                callback_data=f"approve_{application_id}"
            ),
            InlineKeyboardButton(
                text="❌ Отклонить",
                callback_data=f"reject_{application_id}"
            )
        ]
    ])
    return keyboard


def build_topic_groups_keyboard(application_id: int) -> InlineKeyboardMarkup:
    rows = []
    for key, group in TOPIC_GROUPS.items():
        rows.append([
            InlineKeyboardButton(
                text=group["title"],
                callback_data=f"blog_topic_group:{application_id}:{key}"
            )
        ])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def notify_admin_about_application_sync(application_id: int):
    import requests
    import json
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT ba.*, u.first_name, u.last_name, u.username, u.user_id
            FROM blogger_applications ba
            JOIN users u ON ba.user_id = u.user_id
            WHERE ba.id = ?
        """, (application_id,))
        
        row = cursor.fetchone()
        if not row:
            logger.error(f"Application {application_id} not found")
            conn.close()
            return
        
        app_data = dict_from_row(row)
        conn.close()
        
        username = f"@{app_data['username']}" if app_data['username'] else "Не указан"
        full_name = f"{app_data['first_name']} {app_data['last_name']}".strip()
        channel_link = app_data.get('channel_link', 'Не указан')
        
        message_text = (
            "🆕 <b>Новая заявка на блогера</b>\n\n"
            f"👤 <b>Блогер:</b> {full_name}\n"
            f"🆔 <b>ID:</b> <code>{app_data['user_id']}</code>\n"
            f"📱 <b>Username:</b> {username}\n"
            f"📢 <b>Канал:</b> {channel_link}\n"
            f"✅ <b>Бот добавлен:</b> Да\n\n"
            f"<i>Заявка #{application_id}</i>"
        )
        
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "✅ Одобрить", "callback_data": f"approve_{application_id}"},
                    {"text": "❌ Отклонить", "callback_data": f"reject_{application_id}"}
                ]
            ]
        }
        
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": ADMIN_ID,
            "text": message_text,
            "parse_mode": "HTML",
            "reply_markup": json.dumps(keyboard)
        }
        
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        result = response.json()
        
        if result.get('ok'):
            logger.info(f"✅ Admin notified about application #{application_id}")
        else:
            logger.error(f"❌ Telegram API error: {result.get('description', 'Unknown error')}")
        
    except Exception as e:
        logger.error(f"❌ Error notifying admin: {e}", exc_info=True)


async def notify_admin_about_application(application_id: int):
    notify_admin_about_application_sync(application_id)


def notify_admin_about_channel_sync(channel_id: int):
    import requests
    import json
    
    logger.info("=" * 60)
    logger.info(f"📤 SENDING NOTIFICATION TO ADMIN")
    logger.info(f"   Channel ID: {channel_id}")
    logger.info(f"   Admin ID: {ADMIN_ID}")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        logger.info(f"   📊 Fetching channel data from database...")
        cursor.execute("""
            SELECT bc.*, u.first_name, u.last_name, u.username, u.user_id
            FROM blogger_channels bc
            JOIN users u ON bc.user_id = u.user_id
            WHERE bc.id = ?
        """, (channel_id,))
        
        row = cursor.fetchone()
        if not row:
            logger.error(f"   ❌ Channel {channel_id} not found in database!")
            conn.close()
            return
        
        channel_data = dict_from_row(row)
        logger.info(f"   ✅ Channel data fetched:")
        logger.info(f"      User ID: {channel_data['user_id']}")
        logger.info(f"      Channel name: {channel_data.get('channel_name', 'N/A')}")
        logger.info(f"      Subscribers: {channel_data.get('subscribers_count', '0')}")
        
        conn.close()
        
        username = f"@{channel_data['username']}" if channel_data['username'] else "Не указан"
        full_name = f"{channel_data['first_name']} {channel_data['last_name']}".strip()
        channel_name = channel_data.get('channel_name') or 'Не указано'
        subscribers = channel_data.get('subscribers_count') or '0'
        
        message_text = (
            "🆕 <b>Новый канал на одобрение</b>\n\n"
            f"👤 <b>Блогер:</b> {full_name}\n"
            f"🆔 <b>ID:</b> <code>{channel_data['user_id']}</code>\n"
            f"📱 <b>Username:</b> {username}\n"
            f"📢 <b>Канал:</b> {channel_name}\n"
            f"👥 <b>Подписчики:</b> {subscribers}\n"
            f"🔗 <b>Ссылка:</b> {channel_data['channel_link']}\n"
            f"✅ <b>Бот добавлен:</b> Да\n\n"
            f"<i>Канал #{channel_id}</i>"
        )
        
        logger.info(f"   📝 Message prepared (length: {len(message_text)} chars)")
        
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "✅ Одобрить", "callback_data": f"approve_channel_{channel_id}"},
                    {"text": "❌ Отклонить", "callback_data": f"reject_channel_{channel_id}"}
                ]
            ]
        }
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": ADMIN_ID,
            "text": message_text,
            "parse_mode": "HTML",
            "reply_markup": json.dumps(keyboard)
        }
        
        logger.info(f"   🌐 Sending request to Telegram API...")
        logger.info(f"      URL: {url[:50]}...")
        logger.info(f"      Chat ID: {ADMIN_ID}")
        
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"   📥 Response received:")
        logger.info(f"      Status code: {response.status_code}")
        logger.info(f"      OK: {result.get('ok')}")
        
        if result.get('ok'):
            logger.info(f"   ✅ Admin notified successfully about channel #{channel_id}")
            logger.info(f"      Message ID: {result.get('result', {}).get('message_id')}")
        else:
            logger.error(f"   ❌ Telegram API error: {result.get('description', 'Unknown error')}")
            logger.error(f"      Full response: {result}")
        
        logger.info("=" * 60)
        
    except requests.exceptions.RequestException as e:
        logger.error(f"   ❌ Network error: {e}")
        logger.error("=" * 60)
    except Exception as e:
        logger.error(f"   ❌ Error notifying admin about channel: {e}", exc_info=True)
        logger.error("=" * 60)


async def notify_admin_about_channel(channel_id: int):
    notify_admin_about_channel_sync(channel_id)


def notify_admin_about_withdrawal_sync(request_id: int):
    import requests
    import json
    
    logger.info("=" * 60)
    logger.info(f"📤 SENDING WITHDRAWAL NOTIFICATION TO ADMIN")
    logger.info(f"   Request ID: {request_id}")
    logger.info(f"   Admin ID: {ADMIN_ID}")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        logger.info(f"   📊 Fetching withdrawal request data from database...")
        cursor.execute("""
            SELECT wr.*, u.first_name, u.last_name, u.username, u.user_id
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.user_id
            WHERE wr.id = ?
        """, (request_id,))
        
        row = cursor.fetchone()
        if not row:
            logger.error(f"   ❌ Withdrawal request {request_id} not found in database!")
            conn.close()
            return
        
        request_data = dict_from_row(row)
        logger.info(f"   ✅ Withdrawal request data fetched:")
        logger.info(f"      User ID: {request_data['user_id']}")
        logger.info(f"      Amount: {request_data['amount']}")
        logger.info(f"      Wallet: {request_data['wallet_address']}")
        
        conn.close()
        
        username = f"@{request_data['username']}" if request_data['username'] else "Не указан"
        full_name = f"{request_data['first_name']} {request_data['last_name']}".strip()
        amount = request_data['amount']
        wallet = request_data['wallet_address']
        
        message_text = (
            "💸 <b>Новый запрос на вывод средств</b>\n\n"
            f"👤 <b>Блогер:</b> {full_name}\n"
            f"🆔 <b>ID:</b> <code>{request_data['user_id']}</code>\n"
            f"📱 <b>Username:</b> {username}\n"
            f"💰 <b>Сумма:</b> {amount} ₽\n"
            f"💼 <b>Кошелек:</b> <code>{wallet}</code>\n\n"
            f"<i>Запрос #{request_id}</i>"
        )
        
        logger.info(f"📝 Message prepared (length: {len(message_text)} chars)")
        
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "✅ Отправлено", "callback_data": f"withdraw_sent_{request_id}"},
                    {"text": "❌ Отменить", "callback_data": f"withdraw_cancel_{request_id}"}
                ]
            ]
        }
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": ADMIN_ID,
            "text": message_text,
            "parse_mode": "HTML",
            "reply_markup": json.dumps(keyboard)
        }
        
        logger.info(f"   🌐 Sending request to Telegram API...")
        logger.info(f"      URL: {url[:50]}...")
        logger.info(f"      Chat ID: {ADMIN_ID}")
        
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"   📥 Response received:")
        logger.info(f"      Status code: {response.status_code}")
        logger.info(f"      OK: {result.get('ok')}")
        
        if result.get('ok'):
            message_id = result.get('result', {}).get('message_id')
            logger.info(f"   ✅ Admin notified successfully about withdrawal request #{request_id}")
            logger.info(f"      Message ID: {message_id}")
            
            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE withdrawal_requests 
                    SET admin_message_id = ?
                    WHERE id = ?
                """, (message_id, request_id))
                conn.commit()
                conn.close()
                logger.info(f"   ✅ Message ID saved to database")
            except Exception as e:
                logger.error(f"   ❌ Error saving message ID: {e}")
        else:
            logger.error(f"   ❌ Telegram API error: {result.get('description', 'Unknown error')}")
            logger.error(f"      Full response: {result}")
        
        logger.info("=" * 60)
        
    except requests.exceptions.RequestException as e:
        logger.error(f"   ❌ Network error: {e}")
        logger.error("=" * 60)
    except Exception as e:
        logger.error(f"   ❌ Error notifying admin about withdrawal: {e}", exc_info=True)
        logger.error("=" * 60)


async def notify_admin_about_withdrawal(request_id: int):
    """Отправить уведомление админу о запросе на вывод средств (async обертка для совместимости)"""
    notify_admin_about_withdrawal_sync(request_id)



@dp.callback_query(F.data.startswith("approve_") & ~F.data.startswith("approve_channel_"))
async def handle_approve(callback: CallbackQuery):
    """
    Первый шаг одобрения заявки:
    показываем администратору выбор группы тематики канала.
    """
    try:
        logger.info(f"🔔 handle_approve called with data: {callback.data}")
        
        parts = callback.data.split("_")
        if len(parts) != 2:
            logger.error(f"Invalid callback data format: {callback.data}")
            await callback.answer("❌ Неверный формат данных", show_alert=True)
            return
        
        try:
            application_id = int(parts[1])
        except ValueError:
            logger.error(f"Cannot parse application_id from: {callback.data}")
            await callback.answer("❌ Неверный ID заявки", show_alert=True)
            return

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM blogger_applications WHERE id = ?", (application_id,))
        row = cursor.fetchone()

        if not row:
            await callback.answer("❌ Заявка не найдена", show_alert=True)
            conn.close()
            return

        app_data = dict_from_row(row)
        user_id = app_data["user_id"]
        conn.close()

        logger.info(f"📝 Admin {callback.from_user.id} starts topic selection for application #{application_id} (user {user_id})")

        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            "Пожалуйста, выберите <b>группу тематики</b> канала блогера."
        )

        await callback.message.edit_text(
            text=new_text,
            reply_markup=build_topic_groups_keyboard(application_id),
            parse_mode="HTML",
        )

        await callback.answer()

    except Exception as e:
        logger.error(f"❌ Error starting topic selection for approval: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обработке", show_alert=True)


@dp.callback_query(F.data.startswith("blog_topic_group:"))
async def handle_topic_group(callback: CallbackQuery):
    """
    Админ выбрал группу тематики — показываем подкатегории этой группы.
    """
    try:
        _, app_id_str, group_key = callback.data.split(":", 2)
        application_id = int(app_id_str)

        group = TOPIC_GROUPS.get(group_key)
        if not group:
            await callback.answer("❌ Неизвестная группа тематик", show_alert=True)
            return
        rows = []
        for sub_key, title in group["subtopics"]:
            rows.append([
                InlineKeyboardButton(
                    text=title,
                    callback_data=f"blog_topic_sub:{application_id}:{group_key}:{sub_key}",
                )
            ])

        rows.append([
            InlineKeyboardButton(
                text="⬅️ К списку групп",
                callback_data=f"blog_topic_back:{application_id}",
            )
        ])

        keyboard = InlineKeyboardMarkup(inline_keyboard=rows)

        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            f"<b>Группа:</b> {group['title']}\n"
            "Выберите <b>подкатегорию</b> канала."
        )

        await callback.message.edit_text(
            text=new_text,
            reply_markup=keyboard,
            parse_mode="HTML",
        )

        await callback.answer()

    except Exception as e:
        logger.error(f"❌ Error handling topic group selection: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обработке выбора группы", show_alert=True)


@dp.callback_query(F.data.startswith("blog_topic_back:"))
async def handle_topic_back(callback: CallbackQuery):
    """
    Кнопка "назад" из списка подкатегорий — снова показываем группы.
    """
    try:
        _, app_id_str = callback.data.split(":", 1)
        application_id = int(app_id_str)

        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            "Пожалуйста, выберите <b>группу тематики</b> канала блогера."
        )

        await callback.message.edit_text(
            text=new_text,
            reply_markup=build_topic_groups_keyboard(application_id),
            parse_mode="HTML",
        )

        await callback.answer()

    except Exception as e:
        logger.error(f"❌ Error handling topic back button: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обработке кнопки назад", show_alert=True)


@dp.callback_query(F.data.startswith("blog_topic_sub:"))
async def handle_topic_subtopic(callback: CallbackQuery):
    """
    Админ выбрал конкретную подкатегорию — окончательно одобряем заявку.
    """
    try:
        _, app_id_str, group_key, sub_key = callback.data.split(":", 3)
        application_id = int(app_id_str)

        group = TOPIC_GROUPS.get(group_key)
        if not group:
            await callback.answer("❌ Неизвестная группа тематик", show_alert=True)
            return

        subtopic_title = None
        for sk, title in group["subtopics"]:
            if sk == sub_key:
                subtopic_title = title
                break

        if not subtopic_title:
            await callback.answer("❌ Неизвестная подкатегория", show_alert=True)
            return

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM blogger_applications WHERE id = ?", (application_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            await callback.answer("❌ Заявка не найдена", show_alert=True)
            return

        app_data = dict_from_row(row)
        logger.info(f"📋 Application data: {app_data}")
        user_id = app_data["user_id"]
        channel_link = app_data.get("channel_link", "")
        channel_id = app_data.get("channel_id", "") or ""
        
        logger.info(f"🔍 Application #{application_id} details:")
        logger.info(f"   user_id: {user_id}")
        logger.info(f"   channel_link: {channel_link}")
        logger.info(f"   channel_id: '{channel_id}' (empty: {not channel_id})")
        
        if not channel_id:
            logger.warning(f"⚠️ WARNING: channel_id is empty for application {application_id}! Will create channel without Telegram data.")

        cursor.execute(
            """
            UPDATE blogger_applications
            SET status = 'approved',
                topic_group_key = ?,
                topic_group_title = ?,
                topic_sub_key = ?,
                topic_sub_title = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (group_key, group["title"], sub_key, subtopic_title, application_id),
        )

        cursor.execute(
            """
            UPDATE users
            SET user_type = 'blogger', updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
            """,
            (user_id,),
        )

        logger.info(f"🔍 Checking if channel exists in blogger_channels for user {user_id}")
        
        cursor.execute("""
            SELECT id FROM blogger_channels 
            WHERE user_id = ? AND channel_link = ?
        """, (user_id, channel_link))
        
        existing_channel = cursor.fetchone()
        
        channel_name = ""
        channel_photo_url = ""
        subscribers_count = "0"
        
        logger.info(f"📊 Fetching channel data with channel_id: '{channel_id}'")
        
        if channel_id:
            try:
                import requests
                
                logger.info(f"🔄 Fetching channel data from Telegram API for channel_id: {channel_id}")
                
                url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChat"
                response = requests.post(url, json={'chat_id': channel_id}, timeout=10)
                response.raise_for_status()
                chat_data = response.json()
                
                if chat_data.get('ok'):
                    chat = chat_data['result']
                    channel_name = chat.get('title', '')
                    logger.info(f"✅ Got channel name: {channel_name}")
                    
                    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMemberCount"
                    response = requests.post(url, json={'chat_id': channel_id}, timeout=10)
                    response.raise_for_status()
                    count_data = response.json()
                    
                    if count_data.get('ok'):
                        member_count = count_data['result']
                        subscribers_count = str(member_count) if member_count > 0 else "0"
                        logger.info(f"✅ Got subscribers count: {subscribers_count} (raw: {member_count})")
                    
                    if 'photo' in chat and 'big_file_id' in chat['photo']:
                        url = f"https://api.telegram.org/bot{BOT_TOKEN}/getFile"
                        response = requests.post(url, json={'file_id': chat['photo']['big_file_id']}, timeout=10)
                        response.raise_for_status()
                        file_data = response.json()
                        
                        if file_data.get('ok'):
                            file_path = file_data['result']['file_path']
                            channel_photo_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
                            logger.info(f"✅ Got channel photo URL")
                    
                    logger.info(f"✅ Got channel data: name={channel_name}, subs={subscribers_count}, photo={bool(channel_photo_url)}")
                else:
                    logger.error(f"❌ Telegram API error: {chat_data.get('description')}")
            except Exception as e:
                logger.error(f"❌ Error getting channel data from Telegram: {e}")
        else:
            logger.warning(f"⚠️ channel_id is empty! Creating channel without Telegram data")
        
        logger.info(f"📝 Will create channel with: name='{channel_name}', subs='{subscribers_count}', channel_id='{channel_id}'")
        
        if not existing_channel:
            logger.info(f"💾 Inserting into blogger_channels: user_id={user_id}, channel_id='{channel_id}', name='{channel_name}', subs='{subscribers_count}'")
            
            try:
                cursor.execute("""
                    INSERT INTO blogger_channels (
                        user_id, channel_link, channel_id, channel_name,
                        channel_photo_url, subscribers_count,
                        topic_group_key, topic_group_title,
                        topic_sub_key, topic_sub_title,
                        is_verified, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
                """, (
                    user_id, channel_link, channel_id, channel_name,
                    channel_photo_url, subscribers_count,
                    group_key, group["title"], sub_key, subtopic_title
                ))
                
                new_channel_id = cursor.lastrowid
                logger.info(f"✅ Created channel #{new_channel_id} in blogger_channels for user {user_id}")
                
                conn.commit()
                logger.info(f"✅ Database committed after channel creation")
                
                cursor.execute("SELECT id, channel_id, channel_name, subscribers_count FROM blogger_channels WHERE id = ?", (new_channel_id,))
                check_row = cursor.fetchone()
                if check_row:
                    check_data = dict_from_row(check_row)
                    logger.info(f"✅ Verification: channel_id='{check_data.get('channel_id')}', name='{check_data.get('channel_name')}', subs='{check_data.get('subscribers_count')}'")
                else:
                    logger.error(f"❌ Failed to verify created channel!")
                
                logger.info(f"✅ Channel created independently, user data NOT overwritten")
            except Exception as e:
                logger.error(f"❌ CRITICAL ERROR creating channel in blogger_channels: {e}", exc_info=True)
                conn.rollback()
                raise
        else:
            existing_channel_id = existing_channel['id']
            logger.info(f"⚠️ Channel already exists in blogger_channels (id={existing_channel_id})")
            
            logger.info(f"🔄 Updating existing channel with channel_id: '{channel_id}'")
            
            try:
                cursor.execute("""
                    UPDATE blogger_channels
                    SET channel_id = ?,
                        channel_name = ?,
                        channel_photo_url = ?,
                        subscribers_count = ?,
                        topic_group_key = ?,
                        topic_group_title = ?,
                        topic_sub_key = ?,
                        topic_sub_title = ?,
                        is_verified = 1,
                        is_active = 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (channel_id, channel_name, channel_photo_url, subscribers_count,
                      group_key, group["title"], sub_key, subtopic_title, existing_channel_id))
                
                conn.commit()
                logger.info(f"✅ Updated existing channel #{existing_channel_id}")
            except Exception as e:
                logger.error(f"❌ CRITICAL ERROR updating channel in blogger_channels: {e}", exc_info=True)
                conn.rollback()
                raise

        conn.commit()
        logger.info(f"✅ All changes committed to database")
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "🎉 <b>Поздравляем!</b>\n\n"
                    "Ваша заявка на блогера была одобрена!\n"
                    "Теперь вы можете размещать рекламу в своём канале и зарабатывать.\n\n"
                    f"<b>Тематика канала:</b>\n"
                    f"• {group['title']}\n"
                    f"• {subtopic_title}\n\n"
                    "Откройте приложение для доступа к новым функциям."
                ),
                parse_mode="HTML",
            )
            logger.info(f"✅ User {user_id} notified about approval with topic {group_key}/{sub_key}")
        except Exception as e:
            logger.error(f"❌ Failed to notify user {user_id}: {e}")
        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            f"<b>Группа:</b> {group['title']}\n"
            f"<b>Категория:</b> {subtopic_title}\n\n"
            "✅ <b>ОДОБРЕНО</b>"
        )

        await callback.message.edit_text(
            text=new_text,
            parse_mode="HTML",
        )

        await callback.answer("✅ Заявка одобрена", show_alert=True)
        logger.info(
            f"✅ Application #{application_id} approved by admin {callback.from_user.id} "
            f"with topic group={group_key}, subtopic={sub_key}"
        )

    except Exception as e:
        logger.error(f"❌ Error handling topic subcategory selection: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при одобрении заявки", show_alert=True)



@dp.callback_query(F.data.startswith("reject_") & ~F.data.startswith("reject_channel_"))
async def handle_reject(callback: CallbackQuery, state: FSMContext):
    """Обработка отклонения заявки - запрос причины"""
    try:
        logger.info(f"🔔 handle_reject called with data: {callback.data}")
        
        parts = callback.data.split("_")
        if len(parts) != 2:
            logger.error(f"Invalid callback data format: {callback.data}")
            await callback.answer("❌ Неверный формат данных", show_alert=True)
            return
        
        try:
            application_id = int(parts[1])
        except ValueError:
            logger.error(f"Cannot parse application_id from: {callback.data}")
            await callback.answer("❌ Неверный ID заявки", show_alert=True)
            return
        
        await state.update_data(
            application_id=application_id,
            admin_message_id=callback.message.message_id,
            admin_message_text=callback.message.text
        )
        await state.set_state(RejectionStates.waiting_for_reason)
        
        await callback.answer()
        await callback.message.reply(
            text=(
                "📝 <b>Укажите причину отклонения заявки:</b>\n\n"
                "Напишите сообщение, которое будет отправлено пользователю."
            ),
            parse_mode="HTML"
        )
        
    except Exception as e:
        logger.error(f"❌ Error starting rejection: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обработке", show_alert=True)


@dp.message(RejectionStates.waiting_for_reason)
async def process_rejection_reason(message: Message, state: FSMContext):
    """Обработка причины отклонения"""
    try:
        data = await state.get_data()
        application_id = data['application_id']
        reason = message.text
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM blogger_applications WHERE id = ?", (application_id,))
        row = cursor.fetchone()
        
        if not row:
            await message.answer("❌ Заявка не найдена")
            await state.clear()
            conn.close()
            return
        
        app_data = dict_from_row(row)
        user_id = app_data['user_id']
        
        cursor.execute("""
            UPDATE blogger_applications 
            SET status = 'rejected', rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (reason, application_id))
        
        conn.commit()
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "❌ <b>Заявка отклонена</b>\n\n"
                    f"<b>Причина:</b>\n{reason}\n\n"
                    "Вы можете подать заявку снова после исправления указанных замечаний."
                ),
                parse_mode="HTML"
            )
            logger.info(f"✅ User {user_id} notified about rejection")
        except Exception as e:
            logger.error(f"❌ Failed to notify user {user_id}: {e}")
        
        try:
            await bot.edit_message_text(
                chat_id=ADMIN_ID,
                message_id=data['admin_message_id'],
                text=data['admin_message_text'] + f"\n\n❌ <b>ОТКЛОНЕНО</b>\nПричина: {reason}",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"❌ Failed to edit admin message: {e}")
        
        await message.answer(
            text="✅ Заявка отклонена. Пользователь уведомлён.",
        )
        
        await state.clear()
        logger.info(f"✅ Application #{application_id} rejected with reason: {reason}")
        
    except Exception as e:
        logger.error(f"❌ Error processing rejection reason: {e}", exc_info=True)
        await message.answer("❌ Ошибка при обработке")
        await state.clear()


@dp.callback_query(F.data.startswith("approve_channel_"))
async def handle_approve_channel(callback: CallbackQuery):
    """
    Первый шаг одобрения канала:
    показываем администратору выбор группы тематики канала.
    """
    try:
        logger.info(f"🔔 handle_approve_channel called with data: {callback.data}")
        
        parts = callback.data.split("_")
        logger.info(f"📋 Split parts: {parts}")
        
        if len(parts) != 3:
            logger.error(f"❌ Invalid callback data format: {callback.data}, expected 3 parts, got {len(parts)}")
            await callback.answer("❌ Неверный формат данных", show_alert=True)
            return
        
        try:
            channel_id = int(parts[2])
            logger.info(f"✅ Parsed channel_id: {channel_id}")
        except ValueError as e:
            logger.error(f"❌ Cannot parse channel_id from {parts[2]}: {e}")
            await callback.answer("❌ Неверный ID канала", show_alert=True)
            return

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM blogger_channels WHERE id = ?", (channel_id,))
        row = cursor.fetchone()

        if not row:
            await callback.answer("❌ Канал не найден", show_alert=True)
            conn.close()
            return

        channel_data = dict_from_row(row)
        user_id = channel_data["user_id"]
        conn.close()

        logger.info(f"📝 Admin {callback.from_user.id} starts topic selection for channel #{channel_id} (user {user_id})")

        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            "Пожалуйста, выберите <b>группу тематики</b> канала блогера."
        )

        await callback.message.edit_text(
            text=new_text,
            reply_markup=build_topic_groups_keyboard_for_channel(channel_id),
            parse_mode="HTML",
        )

        await callback.answer()

    except Exception as e:
        logger.error(f"❌ Error starting topic selection for channel: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обработке", show_alert=True)


def build_topic_groups_keyboard_for_channel(channel_id: int) -> InlineKeyboardMarkup:
    """Клавиатура с группами тематик для канала"""
    rows = []
    for key, group in TOPIC_GROUPS.items():
        rows.append([
            InlineKeyboardButton(
                text=group["title"],
                callback_data=f"channel_topic_group:{channel_id}:{key}"
            )
        ])
    return InlineKeyboardMarkup(inline_keyboard=rows)


@dp.callback_query(F.data.startswith("channel_topic_group:"))
async def handle_channel_topic_group(callback: CallbackQuery):
    """
    Админ выбрал группу тематики для канала — показываем подкатегории этой группы.
    """
    try:
        _, channel_id_str, group_key = callback.data.split(":", 2)
        channel_id = int(channel_id_str)

        group = TOPIC_GROUPS.get(group_key)
        if not group:
            await callback.answer("❌ Неизвестная группа тематик", show_alert=True)
            return
        rows = []
        for sub_key, title in group["subtopics"]:
            rows.append([
                InlineKeyboardButton(
                    text=title,
                    callback_data=f"channel_topic_sub:{channel_id}:{group_key}:{sub_key}",
                )
            ])

        rows.append([
            InlineKeyboardButton(
                text="⬅️ К списку групп",
                callback_data=f"channel_topic_back:{channel_id}",
            )
        ])

        keyboard = InlineKeyboardMarkup(inline_keyboard=rows)

        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            f"<b>Группа:</b> {group['title']}\n"
            "Выберите <b>подкатегорию</b> канала."
        )

        await callback.message.edit_text(
            text=new_text,
            reply_markup=keyboard,
            parse_mode="HTML",
        )

        await callback.answer()

    except Exception as e:
        logger.error(f"❌ Error handling channel topic group selection: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обработке выбора группы", show_alert=True)


@dp.callback_query(F.data.startswith("channel_topic_back:"))
async def handle_channel_topic_back(callback: CallbackQuery):
    """
    Кнопка "назад" из списка подкатегорий канала — снова показываем группы.
    """
    try:
        _, channel_id_str = callback.data.split(":", 1)
        channel_id = int(channel_id_str)

        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            "Пожалуйста, выберите <b>группу тематики</b> канала блогера."
        )

        await callback.message.edit_text(
            text=new_text,
            reply_markup=build_topic_groups_keyboard_for_channel(channel_id),
            parse_mode="HTML",
        )

        await callback.answer()

    except Exception as e:
        logger.error(f"❌ Error handling channel topic back button: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обработке кнопки назад", show_alert=True)


@dp.callback_query(F.data.startswith("channel_topic_sub:"))
async def handle_channel_topic_subtopic(callback: CallbackQuery):
    """
    Админ выбрал конкретную подкатегорию для канала — окончательно одобряем канал.
    """
    try:
        _, channel_id_str, group_key, sub_key = callback.data.split(":", 3)
        channel_id = int(channel_id_str)

        group = TOPIC_GROUPS.get(group_key)
        if not group:
            await callback.answer("❌ Неизвестная группа тематик", show_alert=True)
            return

        subtopic_title = None
        for sk, title in group["subtopics"]:
            if sk == sub_key:
                subtopic_title = title
                break

        if not subtopic_title:
            await callback.answer("❌ Неизвестная подкатегория", show_alert=True)
            return

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM blogger_channels WHERE id = ?", (channel_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            await callback.answer("❌ Канал не найден", show_alert=True)
            return

        channel_data = dict_from_row(row)
        user_id = channel_data["user_id"]

        cursor.execute(
            """
            UPDATE blogger_channels
            SET topic_group_key = ?,
                topic_group_title = ?,
                topic_sub_key = ?,
                topic_sub_title = ?,
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (group_key, group["title"], sub_key, subtopic_title, channel_id),
        )
        
        cursor.execute("""
            UPDATE users 
            SET user_type = 'blogger',
                blogger_is_active = 1
            WHERE user_id = ?
        """, (user_id,))
        
        cursor.execute("""
            UPDATE blogger_applications
            SET topic_group_key = ?,
                topic_group_title = ?,
                topic_sub_key = ?,
                topic_sub_title = ?,
                status = 'approved'
            WHERE user_id = ?
        """, (group_key, group["title"], sub_key, subtopic_title, user_id))

        conn.commit()
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "🎉 <b>Канал одобрен!</b>\n\n"
                    f"Ваш канал <b>{channel_data.get('channel_name', 'Канал')}</b> был одобрен администратором!\n"
                    "Теперь вы можете размещать рекламу в этом канале и зарабатывать.\n\n"
                    f"<b>Тематика канала:</b>\n"
                    f"• {group['title']}\n"
                    f"• {subtopic_title}\n\n"
                    "Откройте приложение для настройки канала."
                ),
                parse_mode="HTML",
            )
            logger.info(f"✅ User {user_id} notified about channel approval with topic {group_key}/{sub_key}")
        except Exception as e:
            logger.error(f"❌ Failed to notify user {user_id}: {e}")
        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        if "\n\n📂" in base_text:
            base_text = base_text.split("\n\n📂", 1)[0]

        new_text = (
            f"{base_text}\n\n"
            "📂 <b>Тематика канала:</b>\n"
            f"<b>Группа:</b> {group['title']}\n"
            f"<b>Категория:</b> {subtopic_title}\n\n"
            "✅ <b>ОДОБРЕНО</b>"
        )

        await callback.message.edit_text(
            text=new_text,
            parse_mode="HTML",
        )

        await callback.answer("✅ Канал одобрен", show_alert=True)
        logger.info(
            f"✅ Channel #{channel_id} approved by admin {callback.from_user.id} "
            f"with topic group={group_key}, subtopic={sub_key}"
        )

    except Exception as e:
        logger.error(f"❌ Error handling channel topic subcategory selection: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при одобрении канала", show_alert=True)


@dp.callback_query(F.data.startswith("reject_channel_"))
async def handle_reject_channel(callback: CallbackQuery):
    """Обработка отклонения канала - просто удаляем его"""
    try:
        channel_id = int(callback.data.split("_")[2])
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM blogger_channels WHERE id = ?", (channel_id,))
        row = cursor.fetchone()
        
        if not row:
            await callback.answer("❌ Канал не найден", show_alert=True)
            conn.close()
            return
        
        channel_data = dict_from_row(row)
        user_id = channel_data['user_id']
        channel_name = channel_data.get('channel_name', 'Канал')
        
        cursor.execute("DELETE FROM blogger_channels WHERE id = ?", (channel_id,))
        
        conn.commit()
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "❌ <b>Канал отклонен</b>\n\n"
                    f"Ваш канал <b>{channel_name}</b> был отклонен администратором.\n\n"
                    "Вы можете добавить другой канал или обратиться в поддержку."
                ),
                parse_mode="HTML"
            )
            logger.info(f"✅ User {user_id} notified about channel rejection")
        except Exception as e:
            logger.error(f"❌ Failed to notify user {user_id}: {e}")
        
        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        new_text = f"{base_text}\n\n❌ <b>ОТКЛОНЕНО</b>"
        
        try:
            await callback.message.edit_text(
                text=new_text,
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"❌ Failed to edit admin message: {e}")
        
        await callback.answer("✅ Канал отклонен и удален", show_alert=True)
        logger.info(f"✅ Channel #{channel_id} rejected and deleted by admin {callback.from_user.id}")
        
    except Exception as e:
        logger.error(f"❌ Error rejecting channel: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при отклонении канала", show_alert=True)

@dp.callback_query(F.data.startswith("withdraw_sent_"))
async def handle_withdrawal_sent(callback: CallbackQuery):
    """Обработка подтверждения отправки вывода средств"""
    try:
        request_id = int(callback.data.split("_")[2])
        
        logger.info(f"✅ Admin confirmed withdrawal sent: request_id={request_id}")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT wr.*, u.first_name, u.last_name
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.user_id
            WHERE wr.id = ?
        """, (request_id,))
        
        row = cursor.fetchone()
        
        if not row:
            await callback.answer("❌ Запрос не найден", show_alert=True)
            conn.close()
            return
        
        request_data = dict_from_row(row)
        user_id = request_data['user_id']
        amount = request_data['amount']
        full_name = f"{request_data['first_name']} {request_data['last_name']}".strip()
        
        cursor.execute("""
            UPDATE withdrawal_requests 
            SET status = 'approved', processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (request_id,))
        
        conn.commit()
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "✅ <b>Вывод средств выполнен</b>\n\n"
                    f"Сумма <b>{amount} ₽</b> отправлена на ваш кошелек.\n\n"
                    "Спасибо за использование нашего сервиса!"
                ),
                parse_mode="HTML"
            )
            logger.info(f"✅ User {user_id} notified about withdrawal approval")
        except Exception as e:
            logger.error(f"❌ Failed to notify user {user_id}: {e}")
        
        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        new_text = f"{base_text}\n\n✅ <b>ОТПРАВЛЕНО</b>"
        
        try:
            await callback.message.edit_text(
                text=new_text,
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"❌ Failed to edit admin message: {e}")
        
        await callback.answer("✅ Вывод подтвержден", show_alert=True)
        logger.info(f"✅ Withdrawal #{request_id} approved by admin {callback.from_user.id}")
        
    except Exception as e:
        logger.error(f"❌ Error approving withdrawal: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при подтверждении вывода", show_alert=True)


@dp.callback_query(F.data.startswith("withdraw_cancel_"))
async def handle_withdrawal_cancel(callback: CallbackQuery):
    """Обработка отмены вывода средств"""
    try:
        request_id = int(callback.data.split("_")[2])
        
        logger.info(f"❌ Admin cancelled withdrawal: request_id={request_id}")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT wr.*, u.first_name, u.last_name
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.user_id
            WHERE wr.id = ?
        """, (request_id,))
        
        row = cursor.fetchone()
        
        if not row:
            await callback.answer("❌ Запрос не найден", show_alert=True)
            conn.close()
            return
        
        request_data = dict_from_row(row)
        user_id = request_data['user_id']
        amount = request_data['amount']
        full_name = f"{request_data['first_name']} {request_data['last_name']}".strip()
        
        cursor.execute("""
            UPDATE users 
            SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (amount, user_id))
        
        cursor.execute("""
            UPDATE withdrawal_requests 
            SET status = 'rejected', processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (request_id,))
        
        conn.commit()
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "❌ <b>Вывод средств отменен</b>\n\n"
                    f"Администратор отменил вывод средств на сумму <b>{amount} ₽</b>.\n"
                    f"Средства возвращены на ваш баланс.\n\n"
                    "Если у вас есть вопросы, обратитесь в поддержку."
                ),
                parse_mode="HTML"
            )
            logger.info(f"✅ User {user_id} notified about withdrawal cancellation")
        except Exception as e:
            logger.error(f"❌ Failed to notify user {user_id}: {e}")
        
        base_text = getattr(callback.message, "html_text", None) or callback.message.text or ""
        new_text = f"{base_text}\n\n❌ <b>ОТМЕНЕНО</b>"
        
        try:
            await callback.message.edit_text(
                text=new_text,
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"❌ Failed to edit admin message: {e}")
        
        await callback.answer("✅ Вывод отменен, средства возвращены", show_alert=True)
        logger.info(f"✅ Withdrawal #{request_id} cancelled by admin {callback.from_user.id}")
        
    except Exception as e:
        logger.error(f"❌ Error cancelling withdrawal: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при отмене вывода", show_alert=True)


@dp.my_chat_member()
async def bot_status_changed(event: ChatMemberUpdated):
    """Обработка изменения статуса бота в чате"""
    try:
        chat = event.chat
        user = event.from_user
        old_status = event.old_chat_member.status
        new_status = event.new_chat_member.status
        
        logger.info("=" * 60)
        logger.info(f"🔄 Bot status changed in chat")
        logger.info(f"   Chat ID: {chat.id}")
        logger.info(f"   Chat title: {chat.title}")
        logger.info(f"   Chat type: {chat.type}")
        logger.info(f"   User ID: {user.id}")
        logger.info(f"   User: {user.first_name} {user.last_name or ''}")
        logger.info(f"   Username: @{user.username or 'N/A'}")
        logger.info(f"   Old status: {old_status}")
        logger.info(f"   New status: {new_status}")
        logger.info("=" * 60)
        
        if new_status in ['administrator', 'member']:
            logger.info(f"✅ Bot was added/promoted in {chat.type}")
            
            if chat.type != 'channel':
                logger.info(f"   Skipping: not a channel (type={chat.type})")
                return
            
            channel_id = str(chat.id)
            
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM blogger_channels 
                WHERE user_id = ? AND is_verified = 0
                ORDER BY created_at DESC
                LIMIT 1
            """, (user.id,))
            
            channel_row = cursor.fetchone()
            
            if channel_row:
                channel_data = dict_from_row(channel_row)
                channel_db_id = channel_data['id']
                
                logger.info(f"   📝 Found unverified channel #{channel_db_id} in blogger_channels")
                logger.info(f"   📊 Channel BEFORE update:")
                logger.info(f"      Is verified: {channel_data.get('is_verified')}")
                logger.info(f"      Channel ID: {channel_data.get('channel_id')}")
                
                logger.info(f"   🔄 Updating channel #{channel_db_id}...")
                logger.info(f"      Setting channel_id = {channel_id}")
                
                cursor.execute("""
                    UPDATE blogger_channels 
                    SET channel_id = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (channel_id, channel_db_id))
                
                rows_affected = cursor.rowcount
                logger.info(f"   📝 Rows affected: {rows_affected}")
                
                conn.commit()
                logger.info(f"   💾 Changes committed to database")
                
                cursor.execute("""
                    SELECT id, user_id, is_verified, channel_id, updated_at 
                    FROM blogger_channels 
                    WHERE id = ?
                """, (channel_db_id,))
                
                updated_row = cursor.fetchone()
                if updated_row:
                    updated_data = dict_from_row(updated_row)
                    logger.info(f"   ✅ Channel AFTER update:")
                    logger.info(f"      ID: {updated_data.get('id')}")
                    logger.info(f"      User ID: {updated_data.get('user_id')}")
                    logger.info(f"      Is verified: {updated_data.get('is_verified')}")
                    logger.info(f"      Channel ID: '{updated_data.get('channel_id')}'")
                    logger.info(f"      Updated at: {updated_data.get('updated_at')}")
                else:
                    logger.error(f"   ❌ Failed to read back channel #{channel_db_id}")
                
                conn.close()
                
                logger.info(f"✅ Channel #{channel_db_id} updated with channel_id: {channel_id}")
                logger.info(f"   ⏸️  Waiting for user to click 'Verify' button to submit for approval")
                return
            
            cursor.execute("""
                SELECT * FROM blogger_applications 
                WHERE user_id = ? AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
            """, (user.id,))
            
            row = cursor.fetchone()
            
            if not row:
                logger.warning(f"   ⚠️ No pending application or unverified channel found for user {user.id}")
                cursor.execute("""
                    SELECT id, status, verified, created_at FROM blogger_applications 
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                """, (user.id,))
                all_apps = cursor.fetchall()
                if all_apps:
                    logger.info(f"   Found {len(all_apps)} applications for user {user.id}:")
                    for app in all_apps:
                        logger.info(f"     - ID={app['id']}, status={app['status']}, verified={app['verified']}, created={app['created_at']}")
                else:
                    logger.info(f"   No applications at all for user {user.id}")
                cursor.execute("""
                    SELECT id, is_verified, created_at FROM blogger_channels 
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                """, (user.id,))
                all_channels = cursor.fetchall()
                if all_channels:
                    logger.info(f"   Found {len(all_channels)} channels for user {user.id}:")
                    for ch in all_channels:
                        logger.info(f"     - ID={ch['id']}, verified={ch['is_verified']}, created={ch['created_at']}")
                else:
                    logger.info(f"   No channels at all for user {user.id}")
                
                conn.close()
                return
            
            app_data = dict_from_row(row)
            application_id = app_data['id']
            
            logger.info(f"   📝 Found pending application #{application_id}")
            logger.info(f"   📊 Application BEFORE update:")
            logger.info(f"      Status: {app_data.get('status')}")
            logger.info(f"      Verified: {app_data.get('verified')}")
            logger.info(f"      Channel ID: {app_data.get('channel_id')}")
            logger.info(f"   🔄 Updating application #{application_id}...")
            logger.info(f"      Setting verified = 1")
            logger.info(f"      Setting channel_id = {channel_id}")
            
            cursor.execute("""
                UPDATE blogger_applications 
                SET verified = 1, channel_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (channel_id, application_id))
            
            rows_affected = cursor.rowcount
            logger.info(f"   📝 Rows affected: {rows_affected}")
            
            conn.commit()
            logger.info(f"   💾 Changes committed to database")
            cursor.execute("""
                SELECT id, user_id, status, verified, channel_id, updated_at 
                FROM blogger_applications 
                WHERE id = ?
            """, (application_id,))
            
            updated_row = cursor.fetchone()
            if updated_row:
                updated_data = dict_from_row(updated_row)
                logger.info(f"   ✅ Application AFTER update:")
                logger.info(f"      ID: {updated_data.get('id')}")
                logger.info(f"      User ID: {updated_data.get('user_id')}")
                logger.info(f"      Status: {updated_data.get('status')}")
                logger.info(f"      Verified: {updated_data.get('verified')} (type: {type(updated_data.get('verified'))})")
                logger.info(f"      Channel ID: '{updated_data.get('channel_id')}'")
                logger.info(f"      Updated at: {updated_data.get('updated_at')}")
            else:
                logger.error(f"   ❌ Failed to read back application #{application_id}")
            
            conn.close()
            
            logger.info(f"✅ Application #{application_id} verified (channel_id: {channel_id})")
            logger.info(f"   ⏸️  Waiting for user to click 'Verify' button to submit application")
        else:
            logger.info(f"   Skipping: status changed from {old_status} to {new_status} (not an addition)")
        
    except Exception as e:
        logger.error(f"❌ Error handling bot status change: {e}", exc_info=True)


@dp.message(Command("verify"))
async def cmd_verify(message: Message):
    """Админская команда для ручной верификации заявки"""
    try:
        if message.from_user.id != ADMIN_ID:
            await message.answer("❌ Эта команда доступна только администратору")
            return
        args = message.text.split()
        if len(args) != 2:
            await message.answer(
                "❌ Неверный формат команды\n\n"
                "Используйте: <code>/verify USER_ID</code>",
                parse_mode="HTML"
            )
            return
        
        try:
            user_id = int(args[1])
        except ValueError:
            await message.answer("❌ USER_ID должен быть числом")
            return
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM blogger_applications 
            WHERE user_id = ? AND status = 'pending'
            ORDER BY created_at DESC 
            LIMIT 1
        """, (user_id,))
        
        row = cursor.fetchone()
        
        if not row:
            await message.answer(f"❌ Не найдена pending заявка для пользователя {user_id}")
            conn.close()
            return
        
        app_data = dict_from_row(row)
        application_id = app_data['id']
        cursor.execute("""
            UPDATE blogger_applications 
            SET verified = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (application_id,))
        
        conn.commit()
        conn.close()
        
        logger.info(f"✅ Admin {message.from_user.id} manually verified application #{application_id}")
        await message.answer(
            f"✅ Заявка #{application_id} верифицирована\n\n"
            f"Пользователь: {user_id}\n"
            f"Канал: {app_data['channel_link']}\n\n"
            "Отправляю вам уведомление для одобрения...",
            parse_mode="HTML"
        )
        await notify_admin_about_application(application_id)
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "✅ <b>Бот успешно добавлен в канал!</b>\n\n"
                    "Ваша заявка отправлена на модерацию.\n"
                    "Ожидайте решения администратора."
                ),
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"Failed to notify user {user_id}: {e}")
        
    except Exception as e:
        logger.error(f"Error in verify command: {e}", exc_info=True)
        await message.answer("❌ Ошибка при верификации заявки")


@dp.message(Command("start"))
async def cmd_start(message: Message):
    """Обработка команды /start"""
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="Buy ads",
                web_app=WebAppInfo(url="https://beta.heisen.online/")
            )
        ]
    ])

    await message.answer(
        text=(
            "<b>Приветствую тебя в FOUR MILLION ADS!</b>\n\n"
            "Здесь ты можешь купить или продать рекламу, а все процессы проходят через полностью автоматизированную и безопасную систему.\n\n"
            "Мы позаботились о том, чтобы каждая сделка была быстрой, удобной и защищённой.\n\n"
            "Ниже ты найдёшь видеоинструкцию, которая покажет, как пользоваться биржей."
        ),
        reply_markup=keyboard,
        parse_mode="HTML"
    )


@dp.message(Command("help"))
async def cmd_help(message: Message):
    """Обработка команды /help"""
    await message.answer(
        text=(
            "ℹ️ <b>Помощь</b>\n\n"
            "<b>Как стать блогером:</b>\n"
            "1. Откройте приложение через Telegram\n"
            "2. Перейдите в раздел 'Стать блогером'\n"
            "3. Укажите ссылку на ваш канал\n"
            "4. Добавьте бота в канал администратором\n"
            "5. Дождитесь одобрения заявки\n\n"
            "<b>Требования:</b>\n"
            "• Канал должен быть публичным\n"
            "• Бот должен иметь права администратора\n"
            "• Бот должен иметь право публиковать сообщения\n\n"
            "<b>Команды:</b>\n"
            "/check - Проверить статус заявки"
        ),
        parse_mode="HTML"
    )


@dp.message(Command("check"))
async def cmd_check(message: Message):
    """Проверка статуса заявки пользователя"""
    try:
        user_id = message.from_user.id
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM blogger_applications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        """, (user_id,))
        
        row = cursor.fetchone()
        
        if not row:
            await message.answer(
                "❌ У вас нет активных заявок.\n\n"
                "Откройте приложение и подайте заявку на блогера.",
                parse_mode="HTML"
            )
            conn.close()
            return
        
        app_data = dict_from_row(row)
        conn.close()
        
        status = app_data['status']
        verified = bool(app_data['verified'])
        channel_link = app_data['channel_link']
        
        if status == 'approved':
            await message.answer(
                "✅ <b>Ваша заявка одобрена!</b>\n\n"
                "Вы являетесь блогером.",
                parse_mode="HTML"
            )
        elif status == 'rejected':
            reason = app_data.get('rejection_reason', 'Не указана')
            await message.answer(
                f"❌ <b>Ваша заявка отклонена</b>\n\n"
                f"<b>Причина:</b> {reason}\n\n"
                f"Вы можете подать новую заявку после исправления замечаний.",
                parse_mode="HTML"
            )
        elif status == 'pending':
            if verified:
                await message.answer(
                    "⏳ <b>Ваша заявка на модерации</b>\n\n"
                    f"✅ Бот добавлен в канал: {channel_link}\n"
                    "Ожидайте решения администратора.",
                    parse_mode="HTML"
                )
            else:
                await message.answer(
                    "⚠️ <b>Заявка создана, но бот не добавлен в канал</b>\n\n"
                    f"📢 Канал: {channel_link}\n\n"
                    "<b>Что нужно сделать:</b>\n"
                    "1. Перейдите в свой канал\n"
                    "2. Добавьте этого бота как администратора\n"
                    "3. Дайте боту права на отправку сообщений\n\n"
                    "После добавления бота заявка автоматически отправится на модерацию.",
                    parse_mode="HTML"
                )
        
        logger.info(f"User {user_id} checked application status: {status}, verified={verified}")
        
    except Exception as e:
        logger.error(f"Error checking application status: {e}", exc_info=True)
        await message.answer("❌ Ошибка при проверке статуса заявки")
def get_profile_edit_keyboard(user_id: int, is_blogger: bool) -> InlineKeyboardMarkup:
    """Создать клавиатуру для редактирования профиля"""
    blogger_text = "🔻 Снять статус блогера" if is_blogger else "⭐ Сделать блогером"
    blogger_action = "remove_blogger" if is_blogger else "make_blogger"
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="💰 Изменить баланс",
                callback_data=f"edit_balance_{user_id}"
            )
        ],
        [
            InlineKeyboardButton(
                text=blogger_text,
                callback_data=f"{blogger_action}_{user_id}"
            )
        ],
        [
            InlineKeyboardButton(
                text="🔄 Обновить",
                callback_data=f"refresh_profile_{user_id}"
            )
        ]
    ])
    return keyboard


@dp.message(Command("профиль"))
async def cmd_profile(message: Message):
    """Показать профиль пользователя (только для админа)"""
    try:
        if message.from_user.id != ADMIN_ID:
            await message.answer("❌ Эта команда доступна только администратору")
            return
        args = message.text.split()
        if len(args) != 2:
            await message.answer(
                "❌ Неверный формат команды\n\n"
                "Используйте:\n"
                "<code>/профиль @username</code>\n"
                "<code>/профиль username</code>\n"
                "<code>/профиль USER_ID</code>",
                parse_mode="HTML"
            )
            return
        
        search_param = args[1].strip('@')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        user_row = None
        if search_param.isdigit():
            cursor.execute("SELECT * FROM users WHERE user_id = ?", (int(search_param),))
            user_row = cursor.fetchone()
        if not user_row:
            cursor.execute("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", (search_param,))
            user_row = cursor.fetchone()
        
        if not user_row:
            await message.answer(
                f"❌ Пользователь @{search_param} не найден в базе данных\n\n"
                "Попробуйте использовать User ID вместо username."
            )
            conn.close()
            return
        
        user_data = dict_from_row(user_row)
        user_id = user_data['user_id']
        cursor.execute("""
            SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
            FROM orders WHERE user_id = ?
        """, (user_id,))
        orders_stats = cursor.fetchone()
        cursor.execute("""
            SELECT * FROM advertisements 
            WHERE user_id = ? AND status = 'active'
            ORDER BY created_at DESC
        """, (user_id,))
        active_ads = cursor.fetchall()
        cursor.execute("""
            SELECT * FROM blogger_applications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        """, (user_id,))
        blogger_app_row = cursor.fetchone()
        
        conn.close()
        full_name = f"{user_data['first_name']} {user_data['last_name']}".strip()
        username_display = f"@{user_data['username']}" if user_data['username'] else "Не указан"
        is_blogger = user_data.get('user_type') == 'blogger'
        user_type_emoji = "⭐ Блогер" if is_blogger else "👤 Пользователь"
        
        message_text = (
            f"👤 <b>Профиль пользователя</b>\n\n"
            f"<b>Имя:</b> {full_name}\n"
            f"<b>Username:</b> {username_display}\n"
            f"<b>ID:</b> <code>{user_id}</code>\n"
            f"<b>Тип:</b> {user_type_emoji}\n"
            f"<b>Premium:</b> {'✅ Да' if user_data.get('is_premium') else '❌ Нет'}\n"
            f"<b>Язык:</b> {user_data.get('language_code', 'ru')}\n\n"
            
            f"💰 <b>Финансы:</b>\n"
            f"<b>Баланс:</b> {user_data.get('balance', 0):.2f} ₽\n"
            f"<b>Всего заказов:</b> {orders_stats['count']}\n"
            f"<b>Всего потрачено:</b> {orders_stats['total']:.2f} ₽\n\n"
            
            f"📢 <b>Рекламы:</b>\n"
            f"<b>Активных реклам:</b> {len(active_ads)}\n"
        )
        if active_ads:
            message_text += "\n<b>Список активных реклам:</b>\n"
            for ad in active_ads[:5]:  # Показываем максимум 5 реклам
                ad_data = dict_from_row(ad)
                message_text += (
                    f"\n• <b>{ad_data['title']}</b>\n"
                    f"  Бюджет: {ad_data['budget']:.2f} ₽ (потрачено: {ad_data.get('spent', 0):.2f} ₽)\n"
                    f"  Показы: {ad_data.get('impressions', 0)} | Клики: {ad_data.get('clicks', 0)}\n"
                )
            if len(active_ads) > 5:
                message_text += f"\n... и ещё {len(active_ads) - 5} реклам\n"
        message_text += "\n📝 <b>Статус блогера:</b>\n"
        if is_blogger:
            if blogger_app_row:
                app_data = dict_from_row(blogger_app_row)
                message_text += (
                    f"✅ Является блогером\n"
                    f"<b>Канал:</b> {app_data.get('channel_link', 'Не указан')}\n"
                    f"<b>Channel ID:</b> <code>{app_data.get('channel_id', 'Не указан')}</code>\n"
                )
            else:
                message_text += "✅ Является блогером (заявка не найдена)\n"
        else:
            if blogger_app_row:
                app_data = dict_from_row(blogger_app_row)
                status = app_data['status']
                if status == 'pending':
                    message_text += (
                        f"⏳ Заявка на рассмотрении\n"
                        f"<b>Канал:</b> {app_data.get('channel_link', 'Не указан')}\n"
                        f"<b>Верифицирована:</b> {'✅' if app_data.get('verified') else '❌'}\n"
                    )
                elif status == 'rejected':
                    message_text += (
                        f"❌ Заявка отклонена\n"
                        f"<b>Причина:</b> {app_data.get('rejection_reason', 'Не указана')}\n"
                    )
                else:
                    message_text += f"❓ Статус: {status}\n"
            else:
                message_text += "❌ Не подавал заявку на блогера\n"
        
        message_text += (
            f"\n⏰ <b>Даты:</b>\n"
            f"<b>Регистрация:</b> {user_data.get('created_at', 'Не указано')}\n"
            f"<b>Обновлено:</b> {user_data.get('updated_at', 'Не указано')}"
        )
        await message.answer(
            text=message_text,
            reply_markup=get_profile_edit_keyboard(user_id, is_blogger),
            parse_mode="HTML"
        )
        
        logger.info(f"Admin {message.from_user.id} viewed profile of user {user_id} (@{user_data.get('username', search_param)})")
        
    except Exception as e:
        logger.error(f"Error in profile command: {e}", exc_info=True)
        await message.answer("❌ Ошибка при получении профиля пользователя")





@dp.message(Command("setdeletetime"))
async def cmd_set_delete_time(message: Message):
    """
    Админская команда для изменения времени удаления поста
    Использование: 
      /setdeletetime <post_id> <HH:MM> - удалить сегодня/завтра
      /setdeletetime <post_id> <DD.MM HH:MM> - удалить в конкретную дату
    Примеры: 
      /setdeletetime 5 14:30 - удалить в 14:30 сегодня
      /setdeletetime 5 09.02 15:00 - удалить 9 февраля в 15:00
    """
    if message.from_user.id != ADMIN_ID:
        await message.answer("❌ Эта команда доступна только администратору")
        return
    
    try:
        parts = message.text.split()
        if len(parts) < 3:
            await message.answer(
                "❌ Неверный формат команды!\n\n"
                "<b>Использование:</b>\n"
                "<code>/setdeletetime &lt;post_id&gt; &lt;HH:MM&gt;</code>\n"
                "<code>/setdeletetime &lt;post_id&gt; &lt;DD.MM HH:MM&gt;</code>\n\n"
                "<b>Примеры:</b>\n"
                "<code>/setdeletetime 5 14:30</code> - удалить в 14:30 сегодня\n"
                "<code>/setdeletetime 5 09.02 15:00</code> - удалить 9 февраля в 15:00\n"
                "<code>/setdeletetime 5 25.12 23:59</code> - удалить 25 декабря в 23:59\n\n"
                "Время указывается по МСК (UTC+3)",
                parse_mode="HTML"
            )
            return
        
        post_id = int(parts[1])
        now = datetime.now(MOSCOW_TZ)
        
        if len(parts) == 3:
            time_str = parts[2]
            try:
                hour, minute = map(int, time_str.split(':'))
                if not (0 <= hour <= 23 and 0 <= minute <= 59):
                    raise ValueError("Invalid time range")
            except:
                await message.answer("❌ Неверный формат времени! Используйте HH:MM (например, 14:30)")
                return
            new_delete = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if new_delete <= now:
                new_delete += timedelta(days=1)
                
        elif len(parts) == 4:
            date_str = parts[2]
            time_str = parts[3]
            
            try:
                day, month = map(int, date_str.split('.'))
                if not (1 <= day <= 31 and 1 <= month <= 12):
                    raise ValueError("Invalid date range")
                hour, minute = map(int, time_str.split(':'))
                if not (0 <= hour <= 23 and 0 <= minute <= 59):
                    raise ValueError("Invalid time range")
                year = now.year
                new_delete = datetime(year, month, day, hour, minute, 0, tzinfo=MOSCOW_TZ)
                
                if new_delete <= now:
                    year += 1
                    new_delete = datetime(year, month, day, hour, minute, 0, tzinfo=MOSCOW_TZ)
                    
            except ValueError as e:
                await message.answer(
                    "❌ Неверный формат даты/времени!\n\n"
                    "Используйте: <code>DD.MM HH:MM</code>\n"
                    "Например: <code>09.02 15:00</code>",
                    parse_mode="HTML"
                )
                return
        else:
            await message.answer("❌ Слишком много параметров!")
            return
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, status, scheduled_time, delete_time, posted_at FROM ad_posts WHERE id = ?", (post_id,))
        post = cursor.fetchone()
        
        if not post:
            await message.answer(f"❌ Пост #{post_id} не найден")
            conn.close()
            return
        
        old_delete = post[3]
        posted_at = post[4]
        
        new_delete_str = new_delete.strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            UPDATE ad_posts
            SET delete_time = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (new_delete_str, post_id))
        
        conn.commit()
        conn.close()
        time_diff = new_delete - now
        total_minutes = int(time_diff.total_seconds() / 60)
        
        if total_minutes < 60:
            time_left_str = f"{total_minutes}м"
        elif total_minutes < 1440:  # меньше суток
            hours = total_minutes // 60
            mins = total_minutes % 60
            time_left_str = f"{hours}ч {mins}м"
        else:  # больше суток
            days = total_minutes // 1440
            hours = (total_minutes % 1440) // 60
            time_left_str = f"{days}д {hours}ч"
        
        response = f"✅ <b>Время удаления поста #{post_id} изменено!</b>\n\n"
        
        if old_delete:
            response += f"<b>Было:</b> <code>{old_delete}</code>\n"
        
        response += f"<b>Стало:</b> <code>{new_delete_str}</code>\n"
        response += f"📅 Дата: <b>{new_delete.strftime('%d.%m.%Y')}</b>\n"
        response += f"🕐 Время: <b>{new_delete.strftime('%H:%M')}</b> МСК\n\n"
        response += f"⏰ Пост будет удален через <b>{time_left_str}</b>\n"
        response += f"🕐 Текущее время МСК: <code>{now.strftime('%d.%m.%Y %H:%M:%S')}</code>"
        
        if posted_at:
            response += f"\n✅ Пост уже опубликован: {posted_at}"
        else:
            response += f"\n⏳ Пост еще не опубликован"
        
        await message.answer(response, parse_mode="HTML")
        
        logger.info(
            f"⏰ Admin {message.from_user.id} changed post #{post_id} delete time to {new_delete_str}"
        )
        
    except ValueError as e:
        await message.answer(f"❌ Неверный формат! {e}")
    except Exception as e:
        logger.error(f"❌ Error in setdeletetime command: {e}", exc_info=True)
        await message.answer(f"❌ Ошибка: {e}")


@dp.message(Command("listposts"))
async def cmd_list_posts(message: Message):
    """
    Админская команда для просмотра всех активных постов
    """
    if message.from_user.id != ADMIN_ID:
        await message.answer("❌ Эта команда доступна только администратору")
        return
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, buyer_id, blogger_id, status, scheduled_time, delete_time, 
                   posted_at, price
            FROM ad_posts
            WHERE status IN ('pending', 'approved', 'posted')
            ORDER BY id DESC
            LIMIT 10
        """)
        
        posts = cursor.fetchall()
        conn.close()
        
        if not posts:
            await message.answer("📭 Нет активных постов")
            return
        
        now = datetime.now(MOSCOW_TZ)
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        
        response = "📋 <b>Активные посты:</b>\n\n"
        
        for post in posts:
            post_id = post[0]
            buyer_id = post[1]
            blogger_id = post[2]
            status = post[3]
            scheduled = post[4]
            delete_time = post[5]
            posted_at = post[6]
            price = post[7]
            
            status_emoji = {
                'pending': '⏳',
                'approved': '✅',
                'posted': '📤'
            }.get(status, '❓')
            
            response += f"{status_emoji} <b>Пост #{post_id}</b>\n"
            response += f"   Статус: {status}\n"
            response += f"   Цена: {price}₽\n"
            response += f"   📅 Публикация: <code>{scheduled}</code>\n"
            response += f"   🗑 Удаление: <code>{delete_time}</code>\n"
            
            if posted_at:
                response += f"   ✅ Опубликован: {posted_at}\n"
            
            response += "\n"
        
        response += f"⏰ Текущее время: <code>{now_str}</code>\n\n"
        response += "Используйте /setposttime для изменения времени"
        
        await message.answer(response, parse_mode="HTML")
        
    except Exception as e:
        logger.error(f"❌ Error in listposts command: {e}", exc_info=True)
        await message.answer(f"❌ Ошибка: {e}")





@dp.callback_query(F.data.startswith("refresh_profile_"))
async def handle_refresh_profile(callback: CallbackQuery):
    """Обновить информацию профиля"""
    try:
        user_id = int(callback.data.split("_")[2])
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        user_row = cursor.fetchone()
        
        if not user_row:
            await callback.answer("❌ Пользователь не найден", show_alert=True)
            conn.close()
            return
        
        user_data = dict_from_row(user_row)
        cursor.execute("""
            SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
            FROM orders WHERE user_id = ?
        """, (user_id,))
        orders_stats = cursor.fetchone()
        cursor.execute("""
            SELECT * FROM advertisements 
            WHERE user_id = ? AND status = 'active'
            ORDER BY created_at DESC
        """, (user_id,))
        active_ads = cursor.fetchall()
        cursor.execute("""
            SELECT * FROM blogger_applications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        """, (user_id,))
        blogger_app_row = cursor.fetchone()
        
        conn.close()
        full_name = f"{user_data['first_name']} {user_data['last_name']}".strip()
        username_display = f"@{user_data['username']}" if user_data['username'] else "Не указан"
        is_blogger = user_data.get('user_type') == 'blogger'
        user_type_emoji = "⭐ Блогер" if is_blogger else "👤 Пользователь"
        
        message_text = (
            f"👤 <b>Профиль пользователя</b>\n\n"
            f"<b>Имя:</b> {full_name}\n"
            f"<b>Username:</b> {username_display}\n"
            f"<b>ID:</b> <code>{user_id}</code>\n"
            f"<b>Тип:</b> {user_type_emoji}\n"
            f"<b>Premium:</b> {'✅ Да' if user_data.get('is_premium') else '❌ Нет'}\n"
            f"<b>Язык:</b> {user_data.get('language_code', 'ru')}\n\n"
            
            f"💰 <b>Финансы:</b>\n"
            f"<b>Баланс:</b> {user_data.get('balance', 0):.2f} ₽\n"
            f"<b>Всего заказов:</b> {orders_stats['count']}\n"
            f"<b>Всего потрачено:</b> {orders_stats['total']:.2f} ₽\n\n"
            
            f"📢 <b>Рекламы:</b>\n"
            f"<b>Активных реклам:</b> {len(active_ads)}\n"
        )
        if active_ads:
            message_text += "\n<b>Список активных реклам:</b>\n"
            for ad in active_ads[:5]:  # Показываем максимум 5 реклам
                ad_data = dict_from_row(ad)
                message_text += (
                    f"\n• <b>{ad_data['title']}</b>\n"
                    f"  Бюджет: {ad_data['budget']:.2f} ₽ (потрачено: {ad_data.get('spent', 0):.2f} ₽)\n"
                    f"  Показы: {ad_data.get('impressions', 0)} | Клики: {ad_data.get('clicks', 0)}\n"
                )
            if len(active_ads) > 5:
                message_text += f"\n... и ещё {len(active_ads) - 5} реклам\n"
        message_text += "\n📝 <b>Статус блогера:</b>\n"
        if is_blogger:
            if blogger_app_row:
                app_data = dict_from_row(blogger_app_row)
                message_text += (
                    f"✅ Является блогером\n"
                    f"<b>Канал:</b> {app_data.get('channel_link', 'Не указан')}\n"
                    f"<b>Channel ID:</b> <code>{app_data.get('channel_id', 'Не указан')}</code>\n"
                )
            else:
                message_text += "✅ Является блогером (заявка не найдена)\n"
        else:
            if blogger_app_row:
                app_data = dict_from_row(blogger_app_row)
                status = app_data['status']
                if status == 'pending':
                    message_text += (
                        f"⏳ Заявка на рассмотрении\n"
                        f"<b>Канал:</b> {app_data.get('channel_link', 'Не указан')}\n"
                        f"<b>Верифицирована:</b> {'✅' if app_data.get('verified') else '❌'}\n"
                    )
                elif status == 'rejected':
                    message_text += (
                        f"❌ Заявка отклонена\n"
                        f"<b>Причина:</b> {app_data.get('rejection_reason', 'Не указана')}\n"
                    )
                else:
                    message_text += f"❓ Статус: {status}\n"
            else:
                message_text += "❌ Не подавал заявку на блогера\n"
        
        message_text += (
            f"\n⏰ <b>Даты:</b>\n"
            f"<b>Регистрация:</b> {user_data.get('created_at', 'Не указано')}\n"
            f"<b>Обновлено:</b> {user_data.get('updated_at', 'Не указано')}"
        )
        await callback.message.edit_text(
            text=message_text,
            reply_markup=get_profile_edit_keyboard(user_id, is_blogger),
            parse_mode="HTML"
        )
        
        await callback.answer("✅ Профиль обновлён")
        logger.info(f"Admin refreshed profile of user {user_id}")
        
    except Exception as e:
        logger.error(f"Error refreshing profile: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при обновлении профиля", show_alert=True)


@dp.callback_query(F.data.startswith("edit_balance_"))
async def handle_edit_balance(callback: CallbackQuery, state: FSMContext):
    """Начать редактирование баланса"""
    try:
        user_id = int(callback.data.split("_")[2])
        await state.update_data(
            target_user_id=user_id,
            admin_message_id=callback.message.message_id,
            admin_message_text=callback.message.text,
            admin_message_markup=callback.message.reply_markup
        )
        await state.set_state(ProfileEditStates.waiting_for_balance)
        
        await callback.answer()
        await callback.message.reply(
            text=(
                "💰 <b>Изменение баланса</b>\n\n"
                "Отправьте новую сумму баланса (число).\n"
                "Например: <code>1000.50</code>\n\n"
                "Или отправьте <code>/cancel</code> для отмены."
            ),
            parse_mode="HTML"
        )
        
    except Exception as e:
        logger.error(f"Error starting balance edit: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при редактировании баланса", show_alert=True)


@dp.message(ProfileEditStates.waiting_for_balance)
async def process_balance_edit(message: Message, state: FSMContext):
    """Обработка нового баланса"""
    try:
        if message.text and message.text.lower() == '/cancel':
            await state.clear()
            await message.answer("❌ Изменение баланса отменено")
            return
        try:
            new_balance = float(message.text)
        except (ValueError, TypeError):
            await message.answer("❌ Неверный формат. Отправьте число, например: <code>1000.50</code>", parse_mode="HTML")
            return
        
        data = await state.get_data()
        target_user_id = data['target_user_id']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE users 
            SET balance = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (new_balance, target_user_id))
        
        conn.commit()
        conn.close()
        
        await message.answer(
            f"✅ Баланс пользователя {target_user_id} обновлён на {new_balance:.2f} ₽"
        )
        try:
            await bot.send_message(
                chat_id=target_user_id,
                text=(
                    "💰 <b>Ваш баланс был обновлён администратором</b>\n\n"
                    f"Новый баланс: <b>{new_balance:.2f} ₽</b>"
                ),
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"Failed to notify user {target_user_id}: {e}")
        
        await state.clear()
        logger.info(f"Admin {message.from_user.id} updated balance of user {target_user_id} to {new_balance}")
        
    except Exception as e:
        logger.error(f"Error processing balance edit: {e}", exc_info=True)
        await message.answer("❌ Ошибка при обновлении баланса")
        await state.clear()


@dp.callback_query(F.data.startswith("make_blogger_"))
async def handle_make_blogger(callback: CallbackQuery):
    """Сделать пользователя блогером"""
    try:
        user_id = int(callback.data.split("_")[2])
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE users 
            SET user_type = 'blogger', updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (user_id,))
        
        conn.commit()
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "🎉 <b>Поздравляем!</b>\n\n"
                    "Администратор присвоил вам статус блогера!\n"
                    "Теперь вы можете размещать рекламу в своём канале и зарабатывать."
                ),
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"Failed to notify user {user_id}: {e}")
        
        await callback.answer("✅ Пользователь теперь блогер", show_alert=True)
        await handle_refresh_profile(callback)
        
        logger.info(f"Admin {callback.from_user.id} made user {user_id} a blogger")
        
    except Exception as e:
        logger.error(f"Error making blogger: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при изменении статуса", show_alert=True)


@dp.callback_query(F.data.startswith("remove_blogger_"))
async def handle_remove_blogger(callback: CallbackQuery):
    """Снять статус блогера"""
    try:
        user_id = int(callback.data.split("_")[2])
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE users 
            SET user_type = 'user', updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (user_id,))
        
        conn.commit()
        conn.close()
        try:
            await bot.send_message(
                chat_id=user_id,
                text=(
                    "⚠️ <b>Изменение статуса</b>\n\n"
                    "Администратор снял с вас статус блогера.\n"
                    "Теперь вы снова являетесь обычным пользователем."
                ),
                parse_mode="HTML"
            )
        except Exception as e:
            logger.error(f"Failed to notify user {user_id}: {e}")
        
        await callback.answer("✅ Статус блогера снят", show_alert=True)
        await handle_refresh_profile(callback)
        
        logger.info(f"Admin {callback.from_user.id} removed blogger status from user {user_id}")
        
    except Exception as e:
        logger.error(f"Error removing blogger: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при изменении статуса", show_alert=True)


@dp.callback_query(F.data.startswith("review_blogger_"))
async def handle_review_blogger(callback: CallbackQuery):
    """Обработка отзыва покупателя о блогере"""
    try:
        parts = callback.data.split("_")
        blogger_id = int(parts[2])
        post_id = int(parts[3])
        rating = int(parts[4])
        buyer_id = callback.from_user.id
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                reviewer_id INTEGER NOT NULL,
                reviewed_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                review_text TEXT,
                review_type TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(post_id, reviewer_id, review_type)
            )
        """)
        cursor.execute("""
            INSERT OR REPLACE INTO reviews 
            (post_id, reviewer_id, reviewed_id, rating, review_type)
            VALUES (?, ?, ?, ?, 'blogger')
        """, (post_id, buyer_id, blogger_id, rating))
        cursor.execute("""
            SELECT channel_link FROM blogger_applications 
            WHERE user_id = ? AND status = 'approved'
            LIMIT 1
        """, (blogger_id,))
        blogger_data = cursor.fetchone()
        blogger_channel = blogger_data[0] if blogger_data else f"ID: {blogger_id}"
        cursor.execute("""
            SELECT first_name, username FROM users WHERE user_id = ?
        """, (buyer_id,))
        buyer_data = cursor.fetchone()
        buyer_name = f"@{buyer_data[1]}" if buyer_data and buyer_data[1] else (buyer_data[0] if buyer_data else f"ID: {buyer_id}")
        stars_filled = "⭐" * rating
        stars_empty = "☆" * (5 - rating)
        received_message = f"Покупатель {buyer_name} оставил вам отзыв: {stars_filled}{stars_empty}"
        
        cursor.execute("""
            INSERT INTO chat_messages (sender_id, receiver_id, message, message_type, created_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (buyer_id, blogger_id, received_message, "review_received"))
        
        conn.commit()
        conn.close()
        blogger_notification = (
            f"⭐ <b>Покупатель оставил вам отзыв</b>\n\n"
            f"Покупатель: {buyer_name}\n"
            f"Оценка: {rating} из 5\n"
            f"{stars_filled}{stars_empty}"
        )
        
        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_notification,
            parse_mode="HTML"
        )
        
        await callback.answer(f"✅ Отзыв отправлен: {rating} звёзд", show_alert=True)
        
        logger.info(
            f"✅ Review saved: buyer {buyer_id} rated blogger {blogger_id} "
            f"with {rating} stars for post {post_id}"
        )
        
    except Exception as e:
        logger.error(f"❌ Error handling blogger review: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при сохранении отзыва", show_alert=True)


@dp.callback_query(F.data.startswith("review_buyer_"))
async def handle_review_buyer(callback: CallbackQuery):
    """Обработка отзыва блогера о покупателе"""
    try:
        parts = callback.data.split("_")
        buyer_id = int(parts[2])
        post_id = int(parts[3])
        rating = int(parts[4])
        blogger_id = callback.from_user.id
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                reviewer_id INTEGER NOT NULL,
                reviewed_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                review_text TEXT,
                review_type TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(post_id, reviewer_id, review_type)
            )
        """)
        cursor.execute("""
            INSERT OR REPLACE INTO reviews 
            (post_id, reviewer_id, reviewed_id, rating, review_type)
            VALUES (?, ?, ?, ?, 'buyer')
        """, (post_id, blogger_id, buyer_id, rating))
        cursor.execute("""
            SELECT first_name, username FROM users WHERE user_id = ?
        """, (buyer_id,))
        buyer_data = cursor.fetchone()
        buyer_name = f"@{buyer_data[1]}" if buyer_data and buyer_data[1] else (buyer_data[0] if buyer_data else f"ID: {buyer_id}")
        cursor.execute("""
            SELECT channel_link FROM blogger_applications 
            WHERE user_id = ? AND status = 'approved'
            LIMIT 1
        """, (blogger_id,))
        blogger_data = cursor.fetchone()
        blogger_channel = blogger_data[0] if blogger_data else f"ID: {blogger_id}"
        stars_filled = "⭐" * rating
        stars_empty = "☆" * (5 - rating)
        received_message = f"Блогер {blogger_channel} оставил вам отзыв: {stars_filled}{stars_empty}"
        
        cursor.execute("""
            INSERT INTO chat_messages (sender_id, receiver_id, message, message_type, created_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (blogger_id, buyer_id, received_message, "review_received"))
        
        conn.commit()
        conn.close()
        buyer_notification = (
            f"⭐ <b>Блогер оставил вам отзыв</b>\n\n"
            f"Блогер: {blogger_channel}\n"
            f"Оценка: {rating} из 5\n"
            f"{stars_filled}{stars_empty}"
        )
        
        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_notification,
            parse_mode="HTML"
        )
        
        await callback.answer(f"✅ Отзыв отправлен: {rating} звёзд", show_alert=True)
        
        logger.info(
            f"✅ Review saved: blogger {blogger_id} rated buyer {buyer_id} "
            f"with {rating} stars for post {post_id}"
        )
        
    except Exception as e:
        logger.error(f"❌ Error handling buyer review: {e}", exc_info=True)
        await callback.answer("❌ Ошибка при сохранении отзыва", show_alert=True)


async def notify_user_about_new_message(receiver_id: int, sender_id: int, sender_name: str, message_preview: str):
    """Отправить уведомление пользователю о новом сообщении"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM users WHERE user_id = ?", (sender_id,))
        user_row = cursor.fetchone()
        display_name = (sender_name or f"ID: {sender_id}").lstrip('@')

        if user_row:
            sender_data = dict_from_row(user_row)
            user_type = sender_data.get('user_type')

            if user_type == 'blogger':
                cursor.execute("""
                    SELECT channel_link
                    FROM blogger_applications
                    WHERE user_id = ? AND status = 'approved'
                    ORDER BY created_at DESC
                    LIMIT 1
                """, (sender_id,))
                app_row = cursor.fetchone()

                channel_username = None
                if app_row and app_row['channel_link']:
                    channel_link = app_row['channel_link']
                    patterns = [
                        r't\.me/([^/\?]+)',
                        r'telegram\.me/([^/\?]+)',
                        r'@(\w+)'
                    ]
                    for pattern in patterns:
                        match = re.search(pattern, channel_link)
                        if match:
                            username = match.group(1)
                            if not username.startswith('@'):
                                username = '@' + username
                            channel_username = username
                            break

                if channel_username:
                    display_name = channel_username
                else:
                    username = (sender_data.get('username') or '').strip()
                    if username:
                        if not username.startswith('@'):
                            username = '@' + username
                        display_name = username
                    else:
                        display_name = sender_data.get('first_name') or f"ID: {sender_id}"
            else:
                first_name = (sender_data.get('first_name') or '').strip()
                last_name = (sender_data.get('last_name') or '').strip()
                username = (sender_data.get('username') or '').strip().lstrip('@')

                if first_name:
                    display_name = first_name
                elif last_name:
                    display_name = last_name
                elif username:
                    display_name = username
                else:
                    display_name = f"ID: {sender_id}"

        conn.close()
        message_text = f"💬 Новое сообщение от {display_name}"
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат",
                web_app=WebAppInfo(url=f"https://beta.heisen.online/?chat={sender_id}")
            )]
        ])
        await bot.send_message(
            chat_id=receiver_id,
            text=message_text,
            reply_markup=keyboard
        )
        
        logger.info(f"✅ Notification sent to user {receiver_id} about message from {sender_id}")
        
    except Exception as e:
        logger.error(f"❌ Error sending message notification: {e}", exc_info=True)


async def _get_user_display_name(user_id: int) -> str:
    """
    Вспомогательная функция для красивого имени пользователя в уведомлениях.
    Для блогеров стараемся использовать @юзернейм канала,
    для обычных пользователей — имя (first_name) без @.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return f"ID: {user_id}"

        sender_data = dict_from_row(row)
        user_type = sender_data.get('user_type')
        if user_type == 'blogger':
            cursor.execute("""
                SELECT channel_link
                FROM blogger_applications
                WHERE user_id = ? AND status = 'approved'
                ORDER BY created_at DESC
                LIMIT 1
            """, (user_id,))
            app_row = cursor.fetchone()

            channel_username = None
            if app_row and app_row['channel_link']:
                channel_link = app_row['channel_link']
                patterns = [
                    r't\.me/([^/\?]+)',
                    r'telegram\.me/([^/\?]+)',
                    r'@(\w+)'
                ]
                for pattern in patterns:
                    match = re.search(pattern, channel_link)
                    if match:
                        username = match.group(1)
                        if not username.startswith('@'):
                            username = '@' + username
                        channel_username = username
                        break

            if channel_username:
                conn.close()
                return channel_username

            username = (sender_data.get('username') or '').strip()
            if username:
                if not username.startswith('@'):
                    username = '@' + username
                conn.close()
                return username

            full_name = (sender_data.get('first_name') or '').strip()
            conn.close()
            return full_name or f"ID: {user_id}"
        first_name = (sender_data.get('first_name') or '').strip()
        last_name = (sender_data.get('last_name') or '').strip()
        username = (sender_data.get('username') or '').strip().lstrip('@')

        conn.close()

        if first_name:
            return first_name
        if last_name:
            return last_name
        if username:
            return username
        return f"ID: {user_id}"

    except Exception as e:
        logger.error(f"❌ Error getting display name for user {user_id}: {e}", exc_info=True)
        return f"ID: {user_id}"


async def notify_about_ad_post_payment(
    buyer_id: int,
    blogger_id: int,
    price: float,
    post_id: int,
    scheduled_time: str | None = None,
    is_offer: bool = False,
    channel_id: int | None = None,  # NEW: Add channel_id parameter
):
    """
    Уведомление о том, что покупатель оплатил рекламный пост.
    - Покупателю: подтверждение оплаты
    - Блогеру: информация, что покупатель оплатил пост + кнопка перехода в чат
    """
    try:
        buyer_name = await _get_user_display_name(buyer_id)
        blogger_name = await _get_user_display_name(blogger_id)
        buyer_text_lines = [
            "💰 <b>Оплата рекламного поста</b>\n\n",
            f"Вы оплатили пост у {blogger_name} на сумму <b>{price:.2f} ₽</b>.",
        ]
        if scheduled_time:
            buyer_text_lines.append(f"\n🕒 Время публикации: <code>{scheduled_time}</code>")
        buyer_text_lines.append("\n\nОткройте чат, чтобы обсудить детали размещения.")
        buyer_text = "".join(buyer_text_lines)
        if is_offer:
            blogger_text_lines = [
                "💰 <b>Новый оплаченный заказ</b>\n",
                "<b>ОФФЕР</b>\n\n",
                f"Покупатель {buyer_name} оплатил рекламный пост.\n",
                f"Предложенная цена: <b>{price:.2f} ₽</b>.",
            ]
        else:
            blogger_text_lines = [
                "💰 <b>Новый оплаченный заказ</b>\n\n",
                f"Покупатель {buyer_name} оплатил рекламный пост на сумму <b>{price:.2f} ₽</b>.",
            ]
        if scheduled_time:
            blogger_text_lines.append(f"\n🕒 Время публикации: <code>{scheduled_time}</code>")
        blogger_text_lines.append("\n\nОткройте чат с покупателем, чтобы согласовать детали.")
        blogger_text = "".join(blogger_text_lines)
        buyer_chat_url = f"https://beta.heisen.online/?chat={blogger_id}"
        if channel_id:
            buyer_chat_url += f"&channel_id={channel_id}"
        
        blogger_chat_url = f"https://beta.heisen.online/?chat={buyer_id}"
        if channel_id:
            blogger_chat_url += f"&channel_id={channel_id}"
        
        buyer_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Перейти в чат с блогером",
                web_app=WebAppInfo(url=buyer_chat_url)
            )]
        ])

        blogger_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат с покупателем",
                web_app=WebAppInfo(url=blogger_chat_url)
            )]
        ])
        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_text,
            reply_markup=buyer_keyboard,
            parse_mode="HTML"
        )

        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_text,
            reply_markup=blogger_keyboard,
            parse_mode="HTML"
        )

        logger.info(
            f"✅ Notifications about ad post payment sent (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id}, channel_id={channel_id})"
        )

    except Exception as e:
        logger.error(f"❌ Error sending ad post payment notifications: {e}", exc_info=True)


async def notify_about_ad_post_cancelled(
    buyer_id: int,
    blogger_id: int,
    price: float,
    post_id: int,
    channel_id: int | None = None,  # NEW: Add channel_id parameter
):
    """
    Уведомление об отмене заказа покупателем.
    - Покупателю: подтверждение отмены и возврата средств
    - Блогеру: информация, что покупатель отменил заказ
    """
    try:
        buyer_name = await _get_user_display_name(buyer_id)
        blogger_name = await _get_user_display_name(blogger_id)

        buyer_text = (
            "❌ <b>Заказ отменён</b>\n\n"
            f"Вы отменили заказ рекламного поста у {blogger_name}.\n"
            f"Средства <b>{price:.2f} ₽</b> возвращены на ваш баланс."
        )

        blogger_text = (
            "❌ <b>Покупатель отменил заказ</b>\n\n"
            f"Пользователь {buyer_name} отменил оплаченный заказ рекламного поста.\n"
            "Средства возвращены покупателю."
        )
        buyer_chat_url = f"https://beta.heisen.online/?chat={blogger_id}"
        if channel_id:
            buyer_chat_url += f"&channel_id={channel_id}"
        
        blogger_chat_url = f"https://beta.heisen.online/?chat={buyer_id}"
        if channel_id:
            blogger_chat_url += f"&channel_id={channel_id}"

        buyer_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат с блогером",
                web_app=WebAppInfo(url=buyer_chat_url)
            )]
        ])

        blogger_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат с покупателем",
                web_app=WebAppInfo(url=blogger_chat_url)
            )]
        ])

        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_text,
            reply_markup=buyer_keyboard,
            parse_mode="HTML"
        )

        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_text,
            reply_markup=blogger_keyboard,
            parse_mode="HTML"
        )

        logger.info(
            f"✅ Notifications about cancelled ad post sent (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id}, channel_id={channel_id})"
        )
    except Exception as e:
        logger.error(f"❌ Error sending ad post cancel notifications: {e}", exc_info=True)


async def notify_about_ad_post_rejected(
    buyer_id: int,
    blogger_id: int,
    price: float,
    post_id: int,
    channel_id: int | None = None,  # NEW: Add channel_id parameter
):
    """
    Уведомление об отклонении заказа блогером.
    - Покупателю: заказ отклонён, деньги возвращены
    - Блогеру: подтверждение отклонения
    """
    try:
        buyer_name = await _get_user_display_name(buyer_id)
        blogger_name = await _get_user_display_name(blogger_id)

        buyer_text = (
            "❌ <b>Заказ отклонён блогером</b>\n\n"
            f"Блогер {blogger_name} отклонил ваш рекламный пост.\n"
            f"Средства <b>{price:.2f} ₽</b> возвращены на ваш баланс."
        )

        blogger_text = (
            "❌ <b>Вы отклонили рекламный пост</b>\n\n"
            f"Заказ от пользователя {buyer_name} отменён.\n"
            "Средства полностью возвращены покупателю."
        )
        buyer_chat_url = f"https://beta.heisen.online/?chat={blogger_id}"
        if channel_id:
            buyer_chat_url += f"&channel_id={channel_id}"
        
        blogger_chat_url = f"https://beta.heisen.online/?chat={buyer_id}"
        if channel_id:
            blogger_chat_url += f"&channel_id={channel_id}"

        buyer_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат с блогером",
                web_app=WebAppInfo(url=buyer_chat_url)
            )]
        ])

        blogger_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат с покупателем",
                web_app=WebAppInfo(url=blogger_chat_url)
            )]
        ])

        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_text,
            reply_markup=buyer_keyboard,
            parse_mode="HTML"
        )

        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_text,
            reply_markup=blogger_keyboard,
            parse_mode="HTML"
        )

        logger.info(
            f"✅ Notifications about rejected ad post sent (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id}, channel_id={channel_id})"
        )
    except Exception as e:
        logger.error(f"❌ Error sending ad post reject notifications: {e}", exc_info=True)


async def notify_about_ad_post_auto_cancelled(
    buyer_id: int,
    blogger_id: int,
    price: float,
    post_id: int,
    scheduled_time: str | None = None,
    channel_id: int | None = None,  # NEW: Add channel_id parameter
):
    """
    Уведомление об автоматической отмене заказа по времени.
    - Покупателю: заказ не был одобрен до времени публикации, деньги возвращены
    - Блогеру: заказ автоматически отменён, деньги вернулись покупателю
    """
    try:
        buyer_name = await _get_user_display_name(buyer_id)
        blogger_name = await _get_user_display_name(blogger_id)

        buyer_text_lines = [
            "⏰ <b>Заказ автоматически отменён</b>\n\n",
            f"Рекламный пост у {blogger_name} не был одобрен до времени публикации.\n",
            f"Средства <b>{price:.2f} ₽</b> возвращены на ваш баланс.",
        ]
        if scheduled_time:
            buyer_text_lines.append(f"\n\n🕒 Плановое время публикации: <code>{scheduled_time}</code>")
        buyer_text = "".join(buyer_text_lines)

        blogger_text_lines = [
            "⏰ <b>Заказ автоматически отменён</b>\n\n",
            f"Заказ рекламного поста от {buyer_name} был автоматически отменён, ",
            "так как вы не успели одобрить или отклонить его до времени публикации.\n",
            f"Стоимость <b>{price:.2f} ₽</b> возвращена покупателю.",
        ]
        if scheduled_time:
            blogger_text_lines.append(f"\n\n🕒 Плановое время публикации: <code>{scheduled_time}</code>")
        blogger_text = "".join(blogger_text_lines)

        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_text,
            parse_mode="HTML",
        )

        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_text,
            parse_mode="HTML",
        )

        logger.info(
            f"✅ Auto-cancel notifications sent (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id}, channel_id={channel_id})"
        )
    except Exception as e:
        logger.error(f"❌ Error sending auto-cancel ad post notifications: {e}", exc_info=True)


async def notify_about_ad_post_approved(
    buyer_id: int,
    blogger_id: int,
    price: float,
    blogger_amount: float,
    commission_amount: float,
    post_id: int,
    scheduled_time: str | None = None,
    channel_id: int | None = None,  # NEW: Add channel_id parameter
):
    """
    Уведомление об одобрении рекламного поста блогером.
    - Покупателю: статус "в обработке"
    - Блогеру: начисление средств с учётом комиссии
    """
    try:
        buyer_name = await _get_user_display_name(buyer_id)
        blogger_name = await _get_user_display_name(blogger_id)

        commission_percent = (commission_amount / price * 100) if price > 0 else 17

        buyer_text_lines = [
            "✅ <b>Ваш пост одобрен блогером</b>\n\n",
            f"Блогер {blogger_name} одобрил ваш рекламный пост.",
            "\nСтатус заказа: <b>В обработке</b>.",
        ]
        if scheduled_time:
            buyer_text_lines.append(f"\n🕒 Время публикации: <code>{scheduled_time}</code>")
        buyer_text_lines.append("\n\nПри необходимости вы можете написать блогеру в чат.")
        buyer_text = "".join(buyer_text_lines)

        blogger_text = (
            "✅ <b>Вы одобрили рекламный пост</b>\n\n"
            f"Сумма заказа: <b>{price:.2f} ₽</b>\n"
            f"Комиссия сервиса: <b>{commission_amount:.2f} ₽</b> (~{commission_percent:.0f}%)\n"
            f"Начислено на баланс: <b>{blogger_amount:.2f} ₽</b>\n\n"
            f"Покупатель: {buyer_name}\n"
            "Статус заказа: <b>В обработке</b>."
        )
        buyer_chat_url = f"https://beta.heisen.online/?chat={blogger_id}"
        if channel_id:
            buyer_chat_url += f"&channel_id={channel_id}"
        
        blogger_chat_url = f"https://beta.heisen.online/?chat={buyer_id}"
        if channel_id:
            blogger_chat_url += f"&channel_id={channel_id}"

        buyer_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат с блогером",
                web_app=WebAppInfo(url=buyer_chat_url)
            )]
        ])

        blogger_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="Открыть чат с покупателем",
                web_app=WebAppInfo(url=blogger_chat_url)
            )]
        ])

        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_text,
            reply_markup=buyer_keyboard,
            parse_mode="HTML"
        )

        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_text,
            reply_markup=blogger_keyboard,
            parse_mode="HTML"
        )

        logger.info(
            f"✅ Notifications about approved ad post sent (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id}, channel_id={channel_id})"
        )
    except Exception as e:
        logger.error(f"❌ Error sending ad post approve notifications: {e}", exc_info=True)


async def notify_about_ad_post_published(
    buyer_id: int,
    blogger_id: int,
    post_id: int,
    scheduled_time: str | None = None,
    channel_id: int | None = None,  # NEW: Add channel_id parameter
):
    """
    Уведомление о том, что пост был фактически опубликован в канале.
    Пишем и покупателю, и блогеру.
    """
    try:
        buyer_name = await _get_user_display_name(buyer_id)
        blogger_name = await _get_user_display_name(blogger_id)

        buyer_text_lines = [
            "📢 <b>Ваш рекламный пост опубликован</b>\n\n",
            f"Пост у {blogger_name} был размещён в канале.",
        ]
        if scheduled_time:
            buyer_text_lines.append(f"\n🕒 Время публикации: <code>{scheduled_time}</code>")
        buyer_text_lines.append(f"\n\nID заказа: <code>{post_id}</code>")

        blogger_text_lines = [
            "📢 <b>Вы опубликовали рекламный пост</b>\n\n",
            f"Пост от {buyer_name} был отправлен в ваш канал.",
        ]
        if scheduled_time:
            blogger_text_lines.append(f"\n🕒 Время публикации: <code>{scheduled_time}</code>")
        blogger_text_lines.append(f"\n\nID заказа: <code>{post_id}</code>")

        buyer_text = "".join(buyer_text_lines)
        blogger_text = "".join(blogger_text_lines)

        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_text,
            parse_mode="HTML",
        )

        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_text,
            parse_mode="HTML",
        )

        logger.info(
            f"✅ Publish notifications sent (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id}, channel_id={channel_id})"
        )
    except Exception as e:
        logger.error(f"❌ Error sending publish ad post notifications: {e}", exc_info=True)


async def send_review_request(buyer_id: int, blogger_id: int, post_id: int, channel_id: int = None):
    """
    Сохраняет запрос на отзыв в базу данных для отображения в приложении.
    НЕ отправляет сообщения в Telegram - отзывы оставляются только через приложение.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if not channel_id:
            cursor.execute("SELECT channel_id FROM ad_posts WHERE id = ?", (post_id,))
            post_row = cursor.fetchone()
            if post_row:
                channel_id = post_row[0]
        blogger_channel = "@channel"
        blogger_photo_url = None
        
        if channel_id:
            cursor.execute("""
                SELECT channel_link, channel_name, channel_photo_url
                FROM blogger_channels
                WHERE id = ?
            """, (channel_id,))
            channel_data = cursor.fetchone()
            if channel_data:
                channel_link = channel_data[0]
                channel_name = channel_data[1]
                blogger_photo_url = channel_data[2]
                if channel_link:
                    import re
                    patterns = [
                        r't\.me/([^/\?]+)',
                        r'telegram\.me/([^/\?]+)',
                        r'@(\w+)'
                    ]
                    for pattern in patterns:
                        match = re.search(pattern, channel_link)
                        if match:
                            username = match.group(1)
                            if not username.startswith('@'):
                                username = '@' + username
                            blogger_channel = username
                            break
        if not blogger_photo_url:
            cursor.execute(
                """
                SELECT ba.channel_photo_url, u.blogger_photo_url, ba.channel_link
                FROM users u
                LEFT JOIN blogger_applications ba ON u.user_id = ba.user_id AND ba.status = 'approved'
                WHERE u.user_id = ?
                """,
                (blogger_id,)
            )
            blogger_data = cursor.fetchone()
            if blogger_data:
                if blogger_data[2]:
                    blogger_channel = blogger_data[2]
                blogger_photo_url = blogger_data[0] or blogger_data[1]
        cursor.execute("""
            SELECT AVG(rating) as avg_rating
            FROM reviews
            WHERE reviewed_id = ?
        """, (blogger_id,))
        blogger_rating_result = cursor.fetchone()
        blogger_rating = round(blogger_rating_result[0], 1) if blogger_rating_result and blogger_rating_result[0] else 0
        cursor.execute("""
            SELECT AVG(rating) as avg_rating
            FROM reviews
            WHERE reviewed_id = ?
        """, (buyer_id,))
        buyer_rating_result = cursor.fetchone()
        buyer_rating = round(buyer_rating_result[0], 1) if buyer_rating_result and buyer_rating_result[0] else 0
        buyer_photo_url = None
        try:
            buyer_user = await bot.get_chat(buyer_id)
            if buyer_user.photo:
                file = await bot.get_file(buyer_user.photo.big_file_id)
                buyer_photo_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file.file_path}"
        except Exception as e:
            logger.warning(f"Failed to get buyer photo from Telegram: {e}")
            buyer_photo_url = None
        
        logger.info(f"📸 Review request avatars - Blogger: {blogger_photo_url}, Buyer: {buyer_photo_url}, Channel: {blogger_channel}")
        cursor.execute("""
            INSERT INTO chat_messages (sender_id, receiver_id, message, message_type, metadata, channel_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            blogger_id,  # От блогера
            buyer_id,    # Покупателю
            "review_request",
            "system_review",
            json.dumps({
                "post_id": post_id,
                "target_user_id": blogger_id,
                "review_type": "blogger",
                "avatar_url": blogger_photo_url or "",
                "rating": blogger_rating
            }),
            channel_id  # NEW: Добавляем channel_id
        ))
        
        logger.info(f"✅ Saved review request message for buyer {buyer_id} about blogger {blogger_id} (avatar: {blogger_photo_url}, channel_id: {channel_id})")
        cursor.execute("""
            INSERT INTO chat_messages (sender_id, receiver_id, message, message_type, metadata, channel_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            buyer_id,    # От покупателя
            blogger_id,  # Блогеру
            "review_request",
            "system_review",
            json.dumps({
                "post_id": post_id,
                "target_user_id": buyer_id,
                "review_type": "buyer",
                "avatar_url": buyer_photo_url or "",
                "rating": buyer_rating
            }),
            channel_id  # NEW: Добавляем channel_id
        ))
        
        logger.info(f"✅ Saved review request message for blogger {blogger_id} about buyer {buyer_id} (avatar: {buyer_photo_url}, channel_id: {channel_id})")
        
        conn.commit()
        conn.close()
        
        logger.info(
            f"✅ Review requests saved to database (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id}, channel_id={channel_id})"
        )
        
    except Exception as e:
        logger.error(f"❌ Error saving review requests: {e}", exc_info=True)


async def notify_about_ad_post_deleted(
    buyer_id: int,
    blogger_id: int,
    post_id: int,
):
    """
    Уведомление о том, что пост был автоматически удалён из канала.
    """
    try:
        buyer_name = await _get_user_display_name(buyer_id)
        blogger_name = await _get_user_display_name(blogger_id)

        buyer_text = (
            "🗑️ <b>Рекламный пост удалён из канала</b>\n\n"
            f"Размещение у {blogger_name} завершилось, пост был удалён из канала.\n\n"
            f"ID заказа: <code>{post_id}</code>"
        )

        blogger_text = (
            "🗑️ <b>Рекламный пост удалён</b>\n\n"
            f"Размещение поста для {buyer_name} завершилось, пост удалён из вашего канала.\n\n"
            f"ID заказа: <code>{post_id}</code>"
        )

        await bot.send_message(
            chat_id=buyer_id,
            text=buyer_text,
            parse_mode="HTML",
        )

        await bot.send_message(
            chat_id=blogger_id,
            text=blogger_text,
            parse_mode="HTML",
        )

        logger.info(
            f"✅ Delete notifications sent (post_id={post_id}, "
            f"buyer_id={buyer_id}, blogger_id={blogger_id})"
        )
        conn_temp = get_db_connection()
        cursor_temp = conn_temp.cursor()
        cursor_temp.execute("SELECT channel_id FROM ad_posts WHERE id = ?", (post_id,))
        post_row = cursor_temp.fetchone()
        post_channel_id = post_row[0] if post_row else None
        conn_temp.close()
        
        await send_review_request(buyer_id, blogger_id, post_id, channel_id=post_channel_id)
        
    except Exception as e:
        logger.error(f"❌ Error sending delete ad post notifications: {e}", exc_info=True)


async def process_scheduled_ad_posts_once():
    """
    Одна итерация обработки всех отложенных постов:
    - Авто-отмена просроченных pending постов (не одобрены/не отклонены вовремя)
    - Отправка одобренных постов в канал в момент времени публикации
    - Удаление постов из канала, когда наступает время удаления
    """
    try:
        now = datetime.now(MOSCOW_TZ)
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        logger.info(f"🕒 Running scheduled ad posts check at {now_str}")
        cursor.execute(
            """
            SELECT * FROM ad_posts
            WHERE status = 'pending'
              AND scheduled_time <= ?
            """,
            (now_str,),
        )
        pending_rows = cursor.fetchall() or []
        logger.info(f"🔍 Pending posts to auto-cancel: {len(pending_rows)}")

        for row in pending_rows:
            row_dict = dict_from_row(row)
            post_id = row_dict["id"]
            buyer_id = row_dict["buyer_id"]
            blogger_id = row_dict["blogger_id"]
            price = float(row_dict["price"])
            scheduled_time = row_dict.get("scheduled_time")
            channel_id = row_dict.get("channel_id")  # NEW: Get channel_id

            logger.info(
                f"⏰ Auto-cancelling ad post #{post_id}: "
                f"buyer={buyer_id}, blogger={blogger_id}, price={price}, scheduled_time={scheduled_time}, channel_id={channel_id}"
            )
            cursor.execute(
                """
                UPDATE ad_posts
                SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (post_id,),
            )
            cursor.execute(
                """
                UPDATE users
                SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
                """,
                (price, buyer_id),
            )
            conn.commit()

            try:
                await notify_about_ad_post_auto_cancelled(
                    buyer_id=buyer_id,
                    blogger_id=blogger_id,
                    price=price,
                    post_id=post_id,
                    scheduled_time=str(scheduled_time) if scheduled_time else None,
                    channel_id=channel_id  # NEW: Pass channel_id
                )
            except Exception as e:
                logger.error(f"❌ Error sending auto-cancel notifications for post {post_id}: {e}", exc_info=True)
        cursor.execute(
            """
            SELECT 
                ap.id,
                ap.buyer_id,
                ap.blogger_id,
                ap.channel_id as db_channel_id,
                ap.post_text,
                ap.post_images,
                ap.price,
                ap.scheduled_time,
                ap.status,
                ap.posted_at,
                ap.telegram_message_ids,
                bc.channel_id as telegram_channel_id
            FROM ad_posts ap
            LEFT JOIN blogger_channels bc ON ap.channel_id = bc.id
            WHERE ap.status = 'approved'
              AND ap.scheduled_time <= ?
              AND (ap.telegram_message_ids IS NULL OR ap.telegram_message_ids = '')
              AND ap.posted_at IS NULL
            ORDER BY ap.id
            """,
            (now_str,),
        )
        to_publish = cursor.fetchall() or []
        logger.info(f"🔍 Approved posts to publish: {len(to_publish)}")

        for row in to_publish:
            row_dict = dict_from_row(row)
            post_id = row_dict["id"]
            buyer_id = row_dict["buyer_id"]
            blogger_id = row_dict["blogger_id"]
            channel_id = row_dict.get("telegram_channel_id")  # Telegram channel ID from blogger_channels
            post_text = row_dict.get("post_text") or ""
            images_json = row_dict.get("post_images") or "[]"

            if not channel_id:
                logger.warning(
                    f"⚠️ Cannot publish ad post #{post_id}: no channel_id in blogger_channels table"
                )
                continue

            try:
                images = json.loads(images_json) if images_json else []
            except Exception:
                images = []

            message_ids: list[int] = []
            try:
                chat_id = int(channel_id)
            except (TypeError, ValueError):
                chat_id = channel_id

            logger.info(f"📤 Publishing post #{post_id} to chat_id={chat_id} (original channel_id={channel_id})")

            try:
                if images:
                    if len(images) == 1:
                        photo_input = _resolve_photo_input(images[0])
                        if photo_input is None:
                            logger.warning(
                                f"⚠️ Cannot resolve image for ad post #{post_id}, "
                                f"sending text-only message"
                            )
                            msg = await bot.send_message(chat_id=chat_id, text=post_text or "")
                            message_ids.append(msg.message_id)
                        else:
                            msg = await bot.send_photo(
                                chat_id=chat_id,
                                photo=photo_input,
                                caption=post_text or None,
                            )
                            message_ids.append(msg.message_id)
                    else:
                        media = []
                        for idx, img in enumerate(images):
                            photo_input = _resolve_photo_input(img)
                            if photo_input is None:
                                logger.warning(
                                    f"⚠️ Skipping invalid image path '{img}' for ad post #{post_id}"
                                )
                                continue

                            if idx == 0:
                                media.append(
                                    InputMediaPhoto(
                                        media=photo_input,
                                        caption=post_text or None,
                                    )
                                )
                            else:
                                media.append(InputMediaPhoto(media=photo_input))

                        if not media:
                            logger.warning(
                                f"⚠️ All images invalid for ad post #{post_id}, "
                                f"sending text-only message"
                            )
                            msg = await bot.send_message(chat_id=chat_id, text=post_text or "")
                            message_ids.append(msg.message_id)
                        else:
                            sent_messages = await bot.send_media_group(chat_id=chat_id, media=media)
                            message_ids.extend(m.message_id for m in sent_messages)
                else:
                    msg = await bot.send_message(chat_id=chat_id, text=post_text or "")
                    message_ids.append(msg.message_id)

                logger.info(
                    f"✅ Published ad post #{post_id} in channel {channel_id}, "
                    f"messages={message_ids}"
                )

                cursor.execute(
                    """
                    UPDATE ad_posts
                    SET telegram_message_ids = ?, posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (json.dumps(message_ids), post_id),
                )
                conn.commit()
                try:
                    await notify_about_ad_post_published(
                        buyer_id=buyer_id,
                        blogger_id=blogger_id,
                        post_id=post_id,
                        scheduled_time=str(row_dict.get("scheduled_time")),
                        channel_id=channel_id,  # NEW: Pass channel_id
                    )
                except Exception as e:
                    logger.error(
                        f"❌ Error sending publish notifications for ad post #{post_id}: {e}",
                        exc_info=True,
                    )
            except Exception as e:
                logger.error(
                    f"❌ Error publishing ad post #{post_id} to channel {channel_id}: {e}",
                    exc_info=True,
                )
        logger.info(f"🔍 Checking for posts to delete at {now_str}")
        
        cursor.execute(
            """
            SELECT ap.*, bc.channel_id as telegram_channel_id
            FROM ad_posts ap
            LEFT JOIN blogger_channels bc ON ap.channel_id = bc.id
            WHERE ap.status = 'approved'
              AND ap.delete_time <= ?
              AND ap.telegram_message_ids IS NOT NULL
              AND ap.telegram_message_ids != ''
            ORDER BY ap.id
            """,
            (now_str,),
        )
        to_delete = cursor.fetchall() or []
        logger.info(f"🔍 Approved posts to delete: {len(to_delete)}")

        for row in to_delete:
            row_dict = dict_from_row(row)
            post_id = row_dict["id"]
            buyer_id = row_dict["buyer_id"]
            blogger_id = row_dict["blogger_id"]
            channel_id = row_dict.get("telegram_channel_id")  # Telegram channel ID from blogger_channels
            telegram_message_ids_raw = row_dict.get("telegram_message_ids") or "[]"

            if not channel_id:
                logger.warning(
                    f"⚠️ Cannot delete ad post #{post_id}: no channel_id in blogger_channels table"
                )
                continue

            try:
                message_ids = json.loads(telegram_message_ids_raw) if telegram_message_ids_raw else []
            except Exception:
                message_ids = []

            try:
                chat_id = int(channel_id)
            except (TypeError, ValueError):
                chat_id = channel_id

            for mid in message_ids:
                try:
                    await bot.delete_message(chat_id=chat_id, message_id=mid)
                except Exception as e:
                    logger.warning(
                        f"⚠️ Failed to delete message {mid} for ad post #{post_id} "
                        f"in channel {channel_id}: {e}"
                    )

            cursor.execute(
                """
                UPDATE ad_posts
                SET telegram_message_ids = '',
                    status = 'completed',
                    deleted_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (post_id,),
            )
            try:
                from database.escrow_model import EscrowTransaction
                
                release_info = EscrowTransaction.release_to_blogger(cursor, post_id)
                
                if release_info:
                    blogger_amount = release_info['blogger_amount']
                    commission_amount = release_info['commission_amount']
                    from database.models import Order
                    Order.create(
                        cursor,
                        blogger_id,
                        'blogger_earning',
                        f'Доход от рекламного поста #{post_id}',
                        f'Оплаченный пост от пользователя ID{buyer_id}',
                        blogger_amount
                    )
                    try:
                        from database.models import User
                        referral_share_rate = 0.15
                        referral_reward_total = round(commission_amount * referral_share_rate, 2)
                        
                        if referral_reward_total > 0:
                            buyer = User.get_by_id(cursor, buyer_id)
                            blogger = User.get_by_id(cursor, blogger_id)
                            if buyer and buyer.get('referrer_id'):
                                ref_id = buyer['referrer_id']
                                User.update_balance(cursor, ref_id, referral_reward_total, 'add')
                                cursor.execute("""
                                    UPDATE users
                                    SET referral_commission_received = referral_commission_received + ? 
                                    WHERE user_id = ?
                                """, (referral_reward_total, ref_id))
                                cursor.execute("""
                                    UPDATE users
                                    SET referral_commission_generated = referral_commission_generated + ? 
                                    WHERE user_id = ?
                                """, (referral_reward_total, buyer['user_id']))
                            if blogger and blogger.get('referrer_id'):
                                ref_id = blogger['referrer_id']
                                User.update_balance(cursor, ref_id, referral_reward_total, 'add')
                                cursor.execute("""
                                    UPDATE users
                                    SET referral_commission_received = referral_commission_received + ? 
                                    WHERE user_id = ?
                                """, (referral_reward_total, ref_id))
                                cursor.execute("""
                                    UPDATE users
                                    SET referral_commission_generated = referral_commission_generated + ? 
                                    WHERE user_id = ?
                                """, (referral_reward_total, blogger['user_id']))
                    except Exception as e:
                        logger.error(f"❌ Error processing referral commission for ad post #{post_id}: {e}", exc_info=True)
                    
                    logger.info(
                        f"💰 Средства переведены блогеру из escrow: post_id={post_id}, "
                        f"blogger_amount={blogger_amount:.2f}, commission={commission_amount:.2f}"
                    )
                else:
                    logger.warning(f"⚠️ Escrow не найден для поста {post_id}, средства не переведены")
                    
            except Exception as e:
                logger.error(f"❌ Error releasing escrow for ad post #{post_id}: {e}", exc_info=True)
            conn.commit()

            logger.info(
                f"🗑️  Deleted ad post #{post_id} messages from channel {channel_id} "
                f"and marked as completed"
            )
            try:
                await notify_about_ad_post_deleted(
                    buyer_id=buyer_id,
                    blogger_id=blogger_id,
                    post_id=post_id,
                )
            except Exception as e:
                logger.error(
                    f"❌ Error sending delete notifications for ad post #{post_id}: {e}",
                    exc_info=True,
                )

        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"❌ Error in process_scheduled_ad_posts_once: {e}", exc_info=True)


@dp.message(PremiumPostStates.waiting_for_post_content)
async def process_premium_post_content(message: Message, state: FSMContext):
    """Обработка текста и фото для поста с премиум-эмодзи"""
    try:
        user_id = message.from_user.id
        logger.info(f"📝 Received premium post content from user {user_id}")
        logger.info(f"📝 Message type: text={bool(message.text)}, caption={bool(message.caption)}, photo={bool(message.photo)}")
        state_data = await state.get_data()
        session_id = state_data.get('session_id')
        created_at = state_data.get('created_at')
        
        logger.info(f"📝 Session data: session_id={session_id}, created_at={created_at}")
        if created_at:
            from datetime import datetime, timedelta
            created_time = datetime.fromisoformat(created_at)
            if datetime.now() - created_time > timedelta(minutes=5):
                await message.answer(
                    "⏱ Время ожидания истекло. Пожалуйста, начните заново из приложения.",
                    parse_mode="HTML"
                )
                await state.clear()
                return
        post_text = message.text or message.caption or ""
        post_images = []
        if message.photo:
            photo = message.photo[-1]
            file_info = await bot.get_file(photo.file_id)
            file_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_info.file_path}"
            post_images.append(file_url)
        if not post_text and not post_images:
            await message.answer(
                "❌ Пожалуйста, отправьте текст или фото для поста.",
                parse_mode="HTML"
            )
            return
        conn = get_db_connection()
        cursor = conn.cursor()
        telegram_message_id = message.message_id
        telegram_chat_id = message.chat.id
        
        logger.info(f"💾 Saving premium post: message_id={telegram_message_id}, chat_id={telegram_chat_id}")
        cursor.execute("""
            INSERT INTO premium_posts (
                user_id, session_id, post_text, post_images, 
                telegram_message_id, telegram_chat_id, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
        """, (user_id, session_id, post_text, json.dumps(post_images), telegram_message_id, telegram_chat_id))
        
        post_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        logger.info(f"✅ Premium post #{post_id} saved for user {user_id} (msg_id={telegram_message_id})")
        await message.answer(
            "✅ <b>Пост получен!</b>\n\n"
            "Вернитесь в приложение и нажмите <b>Продолжить</b> для завершения оформления.",
            parse_mode="HTML"
        )
        await state.clear()
        
    except Exception as e:
        logger.error(f"❌ Error processing premium post content: {e}", exc_info=True)
        await message.answer(
            "❌ Произошла ошибка при обработке поста. Попробуйте еще раз.",
            parse_mode="HTML"
        )
        await state.clear()


@dp.callback_query(F.data.startswith("cancel_premium_post:"))
async def handle_cancel_premium_post(callback: CallbackQuery, state: FSMContext):
    """Обработка отмены создания премиум-поста"""
    try:
        session_id = callback.data.split(":", 1)[1]
        user_id = callback.from_user.id
        
        logger.info(f"❌ User {user_id} cancelled premium post session {session_id}")
        await state.clear()
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE premium_post_sessions
            SET status = 'cancelled'
            WHERE user_id = ? AND session_id = ?
        """, (user_id, session_id))
        
        conn.commit()
        conn.close()
        try:
            await callback.message.delete()
        except:
            pass
        
        await callback.answer("Создание поста отменено", show_alert=True)
        
    except Exception as e:
        logger.error(f"❌ Error cancelling premium post: {e}", exc_info=True)
        await callback.answer("Ошибка при отмене", show_alert=True)
@dp.message(F.text | F.photo | F.caption)
async def restore_fsm_state_handler(message: Message, state: FSMContext):
    """Восстанавливает FSM состояние из базы данных перед обработкой"""
    try:
        user_id = message.from_user.id
        
        logger.info(f"🔍 Fallback handler triggered for user {user_id}")
        current_state = await state.get_state()
        if current_state:
            logger.info(f"🔄 User {user_id} already has FSM state: {current_state}")
            return
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT state, data FROM bot_fsm_states
            WHERE user_id = ?
        """, (user_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            state_name = row['state']
            state_data = json.loads(row['data'] or '{}')
            
            logger.info(f"🔄 Restoring FSM state for user {user_id}: {state_name}")
            if state_name == "PremiumPostStates:waiting_for_post_content":
                await state.set_state(PremiumPostStates.waiting_for_post_content)
                await state.update_data(**state_data)
                logger.info(f"✅ FSM state restored from DB for user {user_id}: {state_name}")
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM bot_fsm_states WHERE user_id = ?", (user_id,))
                conn.commit()
                conn.close()
                await process_premium_post_content(message, state)
                return
        logger.info(f"ℹ️ No FSM state found for user {user_id}, message not handled")
        
    except Exception as e:
        logger.error(f"❌ Error restoring FSM state: {e}", exc_info=True)


async def ad_posts_scheduler():
    """
    Бесконечный цикл планировщика для обработки отложенных постов.
    Запускается вместе с ботом и каждые 30 секунд проверяет базу.
    """
    logger.info("🕒 Starting ad posts scheduler loop")
    await asyncio.sleep(5)
    while True:
        await process_scheduled_ad_posts_once()
        await asyncio.sleep(30)


async def main():
    """Главная функция запуска бота"""
    logger.info("=" * 60)
    logger.info("🤖 Starting Telegram Bot for Blogger Applications")
    logger.info(f"📝 Bot token configured: {'✅' if BOT_TOKEN else '❌'}")
    if BOT_TOKEN:
        logger.info(f"📝 Bot token (first 20 chars): {BOT_TOKEN[:20]}...")
        logger.info(f"📝 Using env var: {'TELEGRAM_BOT_TOKEN' if os.environ.get('TELEGRAM_BOT_TOKEN') else 'default value'}")
    logger.info(f"👤 Admin ID: {ADMIN_ID}")
    logger.info(f"🗃️  Database: {DATABASE_PATH}")
    logger.info("=" * 60)
    logger.info("🗄️  Initializing database...")
    if not init_db():
        logger.error("❌ Failed to initialize database!")
        return
    logger.info("✅ Database initialized successfully")
    
    try:
        await bot.delete_webhook(drop_pending_updates=True)
        logger.info("✅ Webhook deleted")
        asyncio.create_task(ad_posts_scheduler())
        logger.info("🚀 Ad posts scheduler started")
        logger.info("🚀 Starting polling...")
        logger.info("📡 Listening for: messages, callback_query, my_chat_member")
        await dp.start_polling(
            bot,
            allowed_updates=["message", "callback_query", "my_chat_member"]
        )
    except Exception as e:
        logger.error(f"❌ Error starting bot: {e}", exc_info=True)
    finally:
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Bot stopped by user")



