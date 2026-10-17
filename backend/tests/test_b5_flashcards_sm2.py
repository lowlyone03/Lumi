import uuid
import json
import pytest
from uuid import UUID
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from tests.conftest import USER_A_ID, USER_B_ID
from tests.test_b3_rag_chat import ensure_source_ready_for_user_a

pytestmark = pytest.mark.asyncio

B5_SHARED = {
    "source_id": None,
    "source_version_id": None,
    "deck_id": None,
    "card_id": None,
    "review_item_id": None,
}


async def get_user_a_source_and_version():
    """Lấy source_id và version_id hợp lệ của User A để sinh Flashcards"""
    if B5_SHARED["source_id"] and B5_SHARED["source_version_id"]:
        return B5_SHARED["source_id"], B5_SHARED["source_version_id"]

    source_id = await ensure_source_ready_for_user_a()
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("SELECT active_version_id FROM app.sources WHERE id = :sid"),
            {"sid": str(source_id)},
        )
        version_id = res.scalar()

    B5_SHARED["source_id"] = source_id
    B5_SHARED["source_version_id"] = version_id
    return source_id, version_id


# ============================================================================
# TEST 01: TẠO BỘ THẺ & THÊM THẺ THỦ CÔNG KÈM VALIDATION
# ============================================================================

async def test_01_create_deck_and_manual_cards(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ KHỞI TẠO BỘ THẺ & THÊM THẺ THỦ CÔNG:
    - User A tạo FlashcardDeck ("Cấu trúc Dữ liệu & Giải thuật").
    - Kiểm tra danh sách bộ thẻ: total_cards = 0, due_cards = 0.
    - Thêm một thẻ thủ công (Front: Binary Search, Back: O(log n)).
    - Kiểm tra ràng buộc validation (Front rỗng, locator thiếu source_version).
    """
    # 1. Tạo Deck mới
    deck_payload = {
        "title": "Cấu trúc Dữ liệu & Giải thuật CS101",
        "description": "Bộ thẻ thuật toán phục vụ kỳ thi kết thúc học phần",
        "schedule_enabled": True
    }
    res = await client.post(
        "/api/v1/flashcards/decks",
        json=deck_payload,
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res.status_code == 201
    deck_data = res.json()["data"]
    deck_id = deck_data["id"]
    B5_SHARED["deck_id"] = deck_id
    assert deck_data["title"] == deck_payload["title"]
    assert deck_data["schedule_enabled"] is True

    # 2. Thêm thẻ thủ công vào Deck
    card_payload = {
        "front": "Độ phức tạp thời gian trung bình của giải thuật Tìm kiếm Nhị phân (Binary Search) là bao nhiêu?",
        "back": "Độ phức tạp là O(log n) trên mảng đã sắp xếp.",
        "origin": "user"
    }
    card_res = await client.post(
        f"/api/v1/flashcards/decks/{deck_id}/cards",
        json=card_payload,
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert card_res.status_code == 201
    card_data = card_res.json()["data"]
    B5_SHARED["card_id"] = card_data["id"]
    assert card_data["front"] == card_payload["front"]
    assert card_data["status"] == "active"

    # 3. Kiểm tra validation check constraints
    # a. Front rỗng -> 422
    invalid_front = await client.post(
        f"/api/v1/flashcards/decks/{deck_id}/cards",
        json={"front": "", "back": "Hợp lệ"},
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert invalid_front.status_code == 422

    # b. Locator có dữ liệu nhưng thiếu source_version_id -> 400
    invalid_locator = await client.post(
        f"/api/v1/flashcards/decks/{deck_id}/cards",
        json={
            "front": "Câu hỏi test",
            "back": "Đáp án test",
            "locator": {"type": "pdf_page", "page": 1}
        },
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert invalid_locator.status_code == 400


# ============================================================================
# TEST 02: AI SINH FLASHCARDS TỰ ĐỘNG TỪ HỌC LIỆU
# ============================================================================

async def test_02_ai_generate_flashcards_from_source(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ AI GATEWAY (RADOX AI) SINH THẺ TỰ ĐỘNG:
    - User A yêu cầu sinh 3 flashcards từ tài liệu PDF đã xử lý.
    - AI Gateway phân tích các chunks, trả về JSON thẻ nhớ Front/Back.
    - Lưu tự động vào target_deck_id.
    - Kiểm tra số lượng thẻ trong deck tăng lên (1 thẻ thủ công + 3 thẻ AI = 4 thẻ).
    """
    source_id, version_id = await get_user_a_source_and_version()
    deck_id = B5_SHARED["deck_id"]

    gen_payload = {
        "source_id": str(source_id),
        "source_version_id": str(version_id),
        "num_cards": 3,
        "target_deck_id": deck_id
    }

    res = await client.post(
        "/api/v1/flashcards/generate",
        json=gen_payload,
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res.status_code == 200
    gen_data = res.json()["data"]
    cards = gen_data["cards"]
    assert len(cards) >= 1
    assert gen_data["saved_to_deck_id"] == deck_id

    # Kiểm tra tổng thẻ trong bộ
    deck_cards_res = await client.get(
        f"/api/v1/flashcards/decks/{deck_id}/cards",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert deck_cards_res.status_code == 200
    all_cards = deck_cards_res.json()["data"]
    assert len(all_cards) >= 2


# ============================================================================
# TEST 03: TRUY VẤN DANH SÁCH THẺ ĐẾN HẠN ÔN TẬP (DUE QUEUE)
# ============================================================================

async def test_03_query_due_cards_for_study(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ HÀNG ĐỢI ÔN TẬP THEO THỜI ĐIỂM (DUE QUEUE):
    - Thẻ mới tạo (chưa có CardSchedule) hoặc có due_at <= now() phải xuất hiện trong hàng đợi.
    - GET /api/v1/flashcards/decks/{deck_id}/due trả về danh sách thẻ cần học hôm nay.
    """
    deck_id = B5_SHARED["deck_id"]

    res = await client.get(
        f"/api/v1/flashcards/decks/{deck_id}/due",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res.status_code == 200
    due_cards = res.json()["data"]
    assert len(due_cards) >= 1

    # Kiểm tra deck details có due_cards phản ánh chính xác
    deck_detail_res = await client.get(
        f"/api/v1/flashcards/decks/{deck_id}",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert deck_detail_res.status_code == 200
    deck_info = deck_detail_res.json()["data"]
    assert deck_info["due_cards"] >= 1


# ============================================================================
# TEST 04: CHU KỲ ĐÁNH GIÁ THUẬT TOÁN SM-2 NGUYÊN TỬ TRÊN DB
# ============================================================================

async def test_04_sm2_spaced_repetition_grading_cycle(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ THUẬT TOÁN SM-2 (3 NÚT: 1 KHÓ, 2 VỪA, 3 DỄ) QUA SQL FUNCTION SECURITY DEFINER:
    - Vòng 1: Rating = 2 (Vừa) -> reps=1, interval=1, state='review'.
    - Vòng 2: Rating = 3 (Dễ) -> reps=2, interval=5, ease_factor tăng lên, state='review'.
    - Vòng 3: Rating = 1 (Khó/Quên) -> reps=0, interval=1, ease_factor giảm, lapses tăng, state='relearning'.
    - Kiểm tra nhật ký card_reviews lưu đủ 3 phiên đánh giá.
    """
    card_id = B5_SHARED["card_id"]

    # --- Vòng 1: Đánh giá Rating = 2 (Vừa/Good) ---
    r1_event = str(uuid.uuid4())
    res1 = await client.post(
        f"/api/v1/flashcards/cards/{card_id}/review",
        json={"event_id": r1_event, "rating": 2},
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res1.status_code == 200
    data1 = res1.json()["data"]
    assert data1["rating"] == 2
    assert data1["next_state"]["repetitions"] == 1
    assert data1["next_state"]["interval_days"] == 1
    assert data1["next_state"]["state"] == "review"

    # --- Vòng 2: Đánh giá Rating = 3 (Dễ/Easy) ---
    r2_event = str(uuid.uuid4())
    res2 = await client.post(
        f"/api/v1/flashcards/cards/{card_id}/review",
        json={"event_id": r2_event, "rating": 3},
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res2.status_code == 200
    data2 = res2.json()["data"]
    assert data2["rating"] == 3
    assert data2["next_state"]["repetitions"] == 2
    assert data2["next_state"]["interval_days"] == 5
    assert data2["next_state"]["ease_factor"] >= 2.50
    assert data2["next_state"]["state"] == "review"

    # --- Vòng 3: Đánh giá Rating = 1 (Khó/Quên/Again) ---
    r3_event = str(uuid.uuid4())
    res3 = await client.post(
        f"/api/v1/flashcards/cards/{card_id}/review",
        json={"event_id": r3_event, "rating": 1},
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res3.status_code == 200
    data3 = res3.json()["data"]
    assert data3["rating"] == 1
    assert data3["next_state"]["repetitions"] == 0
    assert data3["next_state"]["interval_days"] == 1
    assert data3["next_state"]["lapses"] >= 1
    assert data3["next_state"]["state"] == "relearning"

    # --- Kiểm tra lịch sử đánh giá thẻ ---
    hist_res = await client.get(
        f"/api/v1/flashcards/cards/{card_id}/history",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert hist_res.status_code == 200
    history = hist_res.json()["data"]
    assert len(history) == 3


# ============================================================================
# TEST 05: BẢO VỆ TÍNH NGUYÊN TỬ & IDEMPOTENCY CỦA EVENT REVIEW
# ============================================================================

async def test_05_sm2_idempotency_protection(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ CHỐNG GỬI LẶP (IDEMPOTENCY):
    - Gửi đánh giá thẻ với một event_id cố định.
    - Gửi lại chính xác event_id đó lần 2 (giả lập lag mạng hoặc retry).
    - Database trả về bản ghi cũ, không cộng dồn interval hay repetitions lần 2.
    """
    card_id = B5_SHARED["card_id"]
    fixed_event_id = str(uuid.uuid4())

    # Gửi lần 1
    res1 = await client.post(
        f"/api/v1/flashcards/cards/{card_id}/review",
        json={"event_id": fixed_event_id, "rating": 2},
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res1.status_code == 200
    d1 = res1.json()["data"]

    # Gửi lần 2 cùng event_id
    res2 = await client.post(
        f"/api/v1/flashcards/cards/{card_id}/review",
        json={"event_id": fixed_event_id, "rating": 2},
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res2.status_code == 200
    d2 = res2.json()["data"]

    # Bản ghi trả về phải trùng ID và nội dung
    assert d1["id"] == d2["id"]
    assert d1["event_id"] == d2["event_id"]
    assert d1["next_state"] == d2["next_state"]


# ============================================================================
# TEST 06: QUẢN LÝ HẠNG MỤC CẦN ÔN TẬP & CHUYỂN THÀNH FLASHCARD
# ============================================================================

async def test_06_review_items_crud_and_conversion(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ REVIEW ITEMS (CÂU SAI TRẮC NGHIỆM / CẦN ÔN):
    - User A lưu một review item với lý do 'wrong_answer'.
    - Lấy danh sách review items -> status là 'open'.
    - Chuyển đổi review item thành một Flashcard trong Deck -> status chuyển thành 'resolved'.
    - Thẻ mới tạo có origin = 'from_review_item'.
    """
    deck_id = B5_SHARED["deck_id"]

    # 1. Tạo review item
    item_payload = {
        "reason": "wrong_answer",
        "personal_note": "Cần xem lại cách cân bằng Cây AVL khi chèn phần tử gây lệch trái-phải (LR Rotation)"
    }
    create_res = await client.post(
        "/api/v1/flashcards/review-items",
        json=item_payload,
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert create_res.status_code == 201
    item_data = create_res.json()["data"]
    item_id = item_data["id"]
    B5_SHARED["review_item_id"] = item_id
    assert item_data["status"] == "open"

    # 2. Lấy danh sách review items
    list_res = await client.get(
        "/api/v1/flashcards/review-items",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert list_res.status_code == 200
    items = list_res.json()["data"]
    assert any(i["id"] == item_id for i in items)

    # 3. Chuyển đổi thành Flashcard trong Deck
    convert_payload = {
        "deck_id": deck_id,
        "front": "Khi nào cần thực hiện phép quay kép LR (Left-Right Rotation) trong Cây AVL?",
        "back": "Khi một nút bị mất cân bằng có hệ số cân bằng +2 và con bên trái của nó có hệ số cân bằng -1."
    }
    convert_res = await client.post(
        f"/api/v1/flashcards/review-items/{item_id}/convert",
        json=convert_payload,
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert convert_res.status_code == 200
    converted_card = convert_res.json()["data"]
    assert converted_card["deck_id"] == deck_id
    assert converted_card["origin"] == "from_review_item"
    assert converted_card["front"] == convert_payload["front"]

    # 4. Kiểm tra review item đã chuyển sang trạng thái 'resolved'
    check_list = await client.get(
        "/api/v1/flashcards/review-items?status_filter=resolved",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert check_list.status_code == 200
    resolved_items = check_list.json()["data"]
    assert any(i["id"] == item_id for i in resolved_items)


# ============================================================================
# TEST 07: BẢO VỆ CÁCH LY DỮ LIỆU ĐA TÀI KHOẢN RLS TRÊN PHASE B5
# ============================================================================

async def test_07_rls_cross_account_isolation_b5(client: AsyncClient, token_user_a: str, token_user_b: str):
    """
    KIỂM THỬ BẢO MẬT RLS (ROW LEVEL SECURITY) GIỮA USER A VÀ USER B:
    - User B không thể đọc chi tiết bộ thẻ của User A (HTTP 404).
    - User B không thể truy vấn danh sách thẻ trong bộ của User A (HTTP 404).
    - User B không thể nộp đánh giá review vào thẻ của User A (HTTP 404).
    - User B không thể chuyển đổi review item của User A (HTTP 404).
    - Danh sách bộ thẻ của User B không nhìn thấy bất kỳ bộ thẻ nào của User A.
    """
    deck_a_id = B5_SHARED["deck_id"]
    card_a_id = B5_SHARED["card_id"]
    item_a_id = B5_SHARED["review_item_id"]

    # 1. User B cố đọc Deck của User A -> 404
    res_b_deck = await client.get(
        f"/api/v1/flashcards/decks/{deck_a_id}",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_b_deck.status_code == 404

    # 2. User B cố xem danh sách thẻ trong Deck của User A -> 404
    res_b_cards = await client.get(
        f"/api/v1/flashcards/decks/{deck_a_id}/cards",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_b_cards.status_code == 404

    # 3. User B cố submit review vào thẻ của User A -> 404
    res_b_review = await client.post(
        f"/api/v1/flashcards/cards/{card_a_id}/review",
        json={"rating": 2},
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_b_review.status_code == 404

    # 4. User B cố convert ReviewItem của User A -> 404
    res_b_convert = await client.post(
        f"/api/v1/flashcards/review-items/{item_a_id}/convert",
        json={"deck_id": deck_a_id},
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_b_convert.status_code == 404

    # 5. Danh sách Decks của User B không rò rỉ Deck của User A
    res_b_list = await client.get(
        "/api/v1/flashcards/decks",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_b_list.status_code == 200
    user_b_decks = res_b_list.json()["data"]
    assert not any(d["id"] == deck_a_id for d in user_b_decks)
