CREATE OR REPLACE FUNCTION app.record_card_review(p_event_id uuid, p_card_id uuid, p_rating smallint)
 RETURNS app.card_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'pg_temp'
AS $function$
DECLARE
    v_uid uuid := app.current_user_id();
    v_existing app.card_reviews;
    v_sched app.card_schedules;
    v_prev jsonb;
    v_next_interval integer;
    v_next_reps integer;
    v_next_ef numeric(4,2);
    v_next_lapses integer;
    v_next_state app.card_schedule_state;
    v_next_due timestamptz;
    v_rev app.card_reviews;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: active user required'
            USING ERRCODE = '42501';
    END IF;

    IF p_rating NOT BETWEEN 1 AND 3 THEN
        RAISE EXCEPTION 'INVALID_RATING: rating must be 1, 2, or 3'
            USING ERRCODE = '22023';
    END IF;

    -- Khóa lịch thẻ của người dùng (hoặc khởi tạo nếu chưa có)
    INSERT INTO app.card_schedules (card_id, owner_id)
    VALUES (p_card_id, v_uid)
    ON CONFLICT (card_id, owner_id) DO NOTHING;

    SELECT * INTO v_sched
    FROM app.card_schedules
    WHERE card_id = p_card_id AND owner_id = v_uid
    FOR UPDATE;

    -- Nếu event_id đã được xử lý trước đó -> trả về bản ghi cũ, không cộng lịch 2 lần!
    SELECT * INTO v_existing
    FROM app.card_reviews
    WHERE owner_id = v_uid AND event_id = p_event_id;

    IF FOUND THEN
        RETURN v_existing;
    END IF;

    v_prev := jsonb_build_object(
        'state', v_sched.state,
        'due_at', v_sched.due_at,
        'interval_days', v_sched.interval_days,
        'repetitions', v_sched.repetitions,
        'ease_factor', v_sched.ease_factor,
        'lapses', v_sched.lapses
    );

    -- Ánh xạ 3 nút (1: Khó, 2: Bình thường, 3: Dễ) sang SM-2 rút gọn
    IF p_rating = 1 THEN
        v_next_reps     := 0;
        v_next_interval := 1;
        v_next_ef       := GREATEST(1.30, v_sched.ease_factor - 0.20);
        v_next_lapses   := v_sched.lapses + 1;
        v_next_state    := 'relearning';
    ELSIF p_rating = 2 THEN
        v_next_reps     := v_sched.repetitions + 1;
        v_next_interval := CASE
            WHEN v_sched.repetitions = 0 THEN 1
            WHEN v_sched.repetitions = 1 THEN 3
            ELSE GREATEST(1, round(v_sched.interval_days * v_sched.ease_factor)::integer)
        END;
        v_next_ef       := v_sched.ease_factor;
        v_next_lapses   := v_sched.lapses;
        v_next_state    := 'review';
    ELSE
        v_next_reps     := v_sched.repetitions + 1;
        v_next_interval := CASE
            WHEN v_sched.repetitions = 0 THEN 2
            WHEN v_sched.repetitions = 1 THEN 5
            ELSE GREATEST(2, round(v_sched.interval_days * (v_sched.ease_factor + 0.15))::integer)
        END;
        v_next_ef       := LEAST(3.00, v_sched.ease_factor + 0.10);
        v_next_lapses   := v_sched.lapses;
        v_next_state    := 'review';
    END IF;

    v_next_due := now() + make_interval(days => v_next_interval);

    UPDATE app.card_schedules
    SET state            = v_next_state,
        due_at           = v_next_due,
        interval_days    = v_next_interval,
        repetitions      = v_next_reps,
        ease_factor      = v_next_ef,
        lapses           = v_next_lapses,
        last_reviewed_at = now(),
        updated_at       = now()
    WHERE card_id = p_card_id AND owner_id = v_uid;

    INSERT INTO app.card_reviews (
        event_id, card_id, owner_id, rating, reviewed_at, prev_state, next_state
    )
    VALUES (
        p_event_id, p_card_id, v_uid, p_rating, now(), v_prev,
        jsonb_build_object(
            'state', v_next_state,
            'due_at', v_next_due,
            'interval_days', v_next_interval,
            'repetitions', v_next_reps,
            'ease_factor', v_next_ef,
            'lapses', v_next_lapses
        )
    )
    RETURNING * INTO v_rev;

    RETURN v_rev;
END;
$function$


