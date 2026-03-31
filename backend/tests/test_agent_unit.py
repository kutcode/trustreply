"""Unit tests for pure functions in app.services.agent."""

import json
import pytest
import httpx

from app.services.agent import (
    AgentRuntimeConfig,
    AGENT_MODE_AGENT,
    AGENT_MODE_OFF,
    PROVIDER_OPENAI,
    PROVIDER_OPENAI_COMPATIBLE,
    PROVIDER_ANTHROPIC,
    append_trace,
    is_agent_available,
    list_agent_modes,
    normalize_agent_mode,
    _extract_json_object,
    _content_to_text,
    _response_error_detail,
    _is_retriable_response,
    _is_non_retriable_quota_error,
    _retry_delay_seconds,
    _chunked,
    _normalize_provider,
)


# ── normalize_agent_mode ─────────────────────────────────────────────


class TestNormalizeAgentMode:
    def test_agent_mode(self):
        assert normalize_agent_mode("agent") == AGENT_MODE_AGENT

    def test_off_mode(self):
        assert normalize_agent_mode("off") == AGENT_MODE_OFF

    def test_case_insensitive(self):
        assert normalize_agent_mode("AGENT") == AGENT_MODE_AGENT
        assert normalize_agent_mode("Off") == AGENT_MODE_OFF

    def test_alias_assist(self):
        assert normalize_agent_mode("assist") == AGENT_MODE_AGENT

    def test_alias_full(self):
        assert normalize_agent_mode("full") == AGENT_MODE_AGENT

    def test_strips_whitespace(self):
        assert normalize_agent_mode("  agent  ") == AGENT_MODE_AGENT

    def test_unknown_raises(self):
        with pytest.raises(ValueError, match="Unknown agent mode"):
            normalize_agent_mode("turbo")

    def test_none_falls_back_to_default(self):
        # None should use settings.agent_default_mode (set to "agent" in conftest)
        result = normalize_agent_mode(None)
        assert result in (AGENT_MODE_AGENT, AGENT_MODE_OFF)


# ── _normalize_provider ──────────────────────────────────────────────


class TestNormalizeProvider:
    def test_openai(self):
        assert _normalize_provider("openai") == PROVIDER_OPENAI

    def test_anthropic(self):
        assert _normalize_provider("anthropic") == PROVIDER_ANTHROPIC

    def test_claude_alias(self):
        assert _normalize_provider("claude") == PROVIDER_ANTHROPIC

    def test_openai_compatible_hyphen(self):
        assert _normalize_provider("openai-compatible") == PROVIDER_OPENAI_COMPATIBLE

    def test_openai_compatible_underscore(self):
        assert _normalize_provider("openai_compatible") == PROVIDER_OPENAI_COMPATIBLE

    def test_case_insensitive(self):
        assert _normalize_provider("OpenAI") == PROVIDER_OPENAI
        assert _normalize_provider("ANTHROPIC") == PROVIDER_ANTHROPIC

    def test_empty_returns_openai_compatible(self):
        assert _normalize_provider("") == PROVIDER_OPENAI_COMPATIBLE

    def test_none_returns_openai_compatible(self):
        assert _normalize_provider(None) == PROVIDER_OPENAI_COMPATIBLE


# ── list_agent_modes ─────────────────────────────────────────────────


class TestListAgentModes:
    def test_returns_list(self):
        modes = list_agent_modes()
        assert isinstance(modes, list)
        assert len(modes) >= 2

    def test_each_mode_has_required_fields(self):
        for mode in list_agent_modes():
            assert "name" in mode
            assert "label" in mode
            assert "description" in mode

    def test_includes_off_and_agent(self):
        names = {m["name"] for m in list_agent_modes()}
        assert "off" in names
        assert "agent" in names


# ── is_agent_available ───────────────────────────────────────────────


class TestIsAgentAvailable:
    def test_fully_configured(self):
        config = AgentRuntimeConfig(
            api_base="https://api.openai.com/v1",
            api_key="sk-test",
            model="gpt-4",
            provider="openai",
        )
        assert is_agent_available(config) is True

    def test_missing_api_key(self):
        config = AgentRuntimeConfig(
            api_base="https://api.openai.com/v1",
            api_key="",
            model="gpt-4",
        )
        assert is_agent_available(config) is False

    def test_missing_model(self):
        config = AgentRuntimeConfig(
            api_base="https://api.openai.com/v1",
            api_key="sk-test",
            model="",
        )
        assert is_agent_available(config) is False

    def test_missing_api_base(self):
        config = AgentRuntimeConfig(
            api_base="",
            api_key="sk-test",
            model="gpt-4",
        )
        assert is_agent_available(config) is False

    def test_whitespace_only_values_are_unavailable(self):
        config = AgentRuntimeConfig(
            api_base="  ",
            api_key="  ",
            model="  ",
        )
        assert is_agent_available(config) is False


# ── append_trace ─────────────────────────────────────────────────────


class TestAppendTrace:
    def test_appends_event(self):
        trace = []
        append_trace(trace, "parse", "ok", "Parsed 5 questions")
        assert len(trace) == 1
        assert trace[0]["step"] == "parse"
        assert trace[0]["status"] == "ok"
        assert trace[0]["message"] == "Parsed 5 questions"
        assert "timestamp" in trace[0]

    def test_includes_data_when_provided(self):
        trace = []
        append_trace(trace, "match", "ok", "Matched", data={"count": 3})
        assert trace[0]["data"] == {"count": 3}

    def test_excludes_data_key_when_none(self):
        trace = []
        append_trace(trace, "step", "ok", "msg")
        assert "data" not in trace[0]

    def test_multiple_appends(self):
        trace = []
        append_trace(trace, "a", "ok", "first")
        append_trace(trace, "b", "error", "second")
        assert len(trace) == 2
        assert trace[0]["step"] == "a"
        assert trace[1]["step"] == "b"


# ── _extract_json_object ────────────────────────────────────────────


class TestExtractJsonObject:
    def test_plain_json(self):
        result = _extract_json_object('{"answer": "yes"}')
        assert result == {"answer": "yes"}

    def test_json_in_code_fence(self):
        text = '```json\n{"answer": "yes"}\n```'
        result = _extract_json_object(text)
        assert result == {"answer": "yes"}

    def test_json_in_bare_code_fence(self):
        text = '```\n{"answer": "yes"}\n```'
        result = _extract_json_object(text)
        assert result == {"answer": "yes"}

    def test_json_with_surrounding_text(self):
        text = 'Here is the result: {"answer": "yes"} hope that helps!'
        result = _extract_json_object(text)
        assert result == {"answer": "yes"}

    def test_nested_json(self):
        obj = {"answers": {"q1": "yes", "q2": "no"}}
        result = _extract_json_object(json.dumps(obj))
        assert result == obj

    def test_invalid_json_raises(self):
        with pytest.raises((ValueError, json.JSONDecodeError)):
            _extract_json_object("this is not json at all")

    def test_json_array_raises(self):
        with pytest.raises((ValueError, json.JSONDecodeError)):
            _extract_json_object('[1, 2, 3]')

    def test_whitespace_around_json(self):
        result = _extract_json_object('  \n  {"key": "val"}  \n  ')
        assert result == {"key": "val"}


# ── _content_to_text ─────────────────────────────────────────────────


class TestContentToText:
    def test_string_passthrough(self):
        assert _content_to_text("hello") == "hello"

    def test_list_of_text_blocks(self):
        content = [{"type": "text", "text": "hello"}, {"type": "text", "text": "world"}]
        assert _content_to_text(content) == "hello\nworld"

    def test_empty_list(self):
        assert _content_to_text([]) == ""

    def test_non_string_non_list(self):
        assert _content_to_text(42) == "42"


# ── _chunked ─────────────────────────────────────────────────────────


class TestChunked:
    def test_even_split(self):
        assert _chunked([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]

    def test_uneven_split(self):
        assert _chunked([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]

    def test_size_larger_than_list(self):
        assert _chunked([1, 2], 10) == [[1, 2]]

    def test_empty_list(self):
        assert _chunked([], 3) == []

    def test_zero_size_defaults_to_one(self):
        assert _chunked([1, 2, 3], 0) == [[1], [2], [3]]


# ── _is_retriable_response / _retry_delay_seconds ───────────────────


def _make_response(status_code: int, json_body: dict | None = None) -> httpx.Response:
    """Helper to build a mock httpx.Response."""
    content = json.dumps(json_body).encode() if json_body else b""
    return httpx.Response(
        status_code=status_code,
        content=content,
        headers={"content-type": "application/json"} if json_body else {},
    )


class TestIsRetriableResponse:
    def test_429_is_retriable(self):
        resp = _make_response(429)
        assert _is_retriable_response(resp) is True

    def test_500_is_retriable(self):
        assert _is_retriable_response(_make_response(500)) is True

    def test_502_is_retriable(self):
        assert _is_retriable_response(_make_response(502)) is True

    def test_503_is_retriable(self):
        assert _is_retriable_response(_make_response(503)) is True

    def test_408_is_retriable(self):
        assert _is_retriable_response(_make_response(408)) is True

    def test_400_is_not_retriable(self):
        assert _is_retriable_response(_make_response(400)) is False

    def test_401_is_not_retriable(self):
        assert _is_retriable_response(_make_response(401)) is False

    def test_200_is_not_retriable(self):
        assert _is_retriable_response(_make_response(200)) is False

    def test_429_quota_error_is_not_retriable(self):
        body = {"error": {"code": "insufficient_quota", "message": "You exceeded your quota"}}
        resp = _make_response(429, body)
        assert _is_retriable_response(resp) is False

    def test_429_billing_error_is_not_retriable(self):
        body = {"error": {"type": "billing_hard_limit", "message": "Billing limit reached"}}
        resp = _make_response(429, body)
        assert _is_retriable_response(resp) is False


class TestRetryDelaySeconds:
    def test_first_attempt_base_delay(self):
        delay = _retry_delay_seconds(0)
        # Base delay is 1.0s + up to 25% jitter = 1.0 to 1.25
        assert 1.0 <= delay <= 1.3

    def test_increases_with_attempts(self):
        d0 = _retry_delay_seconds(0)
        d2 = _retry_delay_seconds(2)
        # attempt=2 -> base=4.0, should be greater than attempt=0 base=1.0
        assert d2 > d0

    def test_capped_at_max(self):
        delay = _retry_delay_seconds(100)
        assert delay <= 30.0  # AGENT_API_MAX_BACKOFF_SECONDS

    def test_respects_retry_after_header(self):
        resp = _make_response(429)
        resp.headers["retry-after"] = "5"
        delay = _retry_delay_seconds(0, response=resp)
        assert delay == 5.0

    def test_retry_after_capped_at_max(self):
        resp = _make_response(429)
        resp.headers["retry-after"] = "999"
        delay = _retry_delay_seconds(0, response=resp)
        assert delay == 30.0


# ── _response_error_detail ───────────────────────────────────────────


class TestResponseErrorDetail:
    def test_extracts_error_message(self):
        body = {"error": {"message": "Invalid API key", "code": "invalid_api_key"}}
        detail = _response_error_detail(_make_response(401, body))
        assert "Invalid API key" in detail
        assert "invalid_api_key" in detail

    def test_extracts_string_error(self):
        body = {"error": "Something went wrong"}
        detail = _response_error_detail(_make_response(500, body))
        assert detail == "Something went wrong"

    def test_extracts_top_level_message(self):
        body = {"message": "Not found"}
        detail = _response_error_detail(_make_response(404, body))
        assert detail == "Not found"

    def test_falls_back_to_status_code(self):
        resp = httpx.Response(status_code=503, content=b"")
        detail = _response_error_detail(resp)
        assert detail == "HTTP 503"

    def test_falls_back_to_raw_text(self):
        resp = httpx.Response(status_code=500, content=b"Internal Server Error")
        detail = _response_error_detail(resp)
        assert "Internal Server Error" in detail
