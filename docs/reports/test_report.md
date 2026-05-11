# TranslateApp — Reporte de Tests

**Generado:** 2026-05-10 14:31:28

## Resumen

| Suite | Pasados | Fallidos | Duración |
|-------|---------|----------|----------|
| Backend (Python / pytest) | 80 | 0 | 17.0s |
| Frontend (TypeScript / Jest) | 80 | 0 | 0.0s |
| **Total** | **160** | **0** | — |

---

## Backend (Python / pytest)

| Archivo | Test | Resultado |
|---------|------|-----------|
| `tests/test_models_utils.py` | TestSelectDevice::test_cpu_explicit_always_returns_cpu | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_cpu_explicit_no_cuda | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_gpu_with_cuda_available | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_gpu_without_cuda_falls_back_to_cpu | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_auto_with_cuda | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_auto_without_cuda | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_cuda_alias | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_none_treated_as_auto | ✓ PASSED |
| `tests/test_models_utils.py` | TestSelectDevice::test_unknown_value_treated_as_auto | ✓ PASSED |
| `tests/test_models_utils.py` | TestLoadNameGlossary::test_loads_names_from_file | ✓ PASSED |
| `tests/test_models_utils.py` | TestLoadNameGlossary::test_skips_comments_and_blank_lines | ✓ PASSED |
| `tests/test_models_utils.py` | TestLoadNameGlossary::test_missing_file_returns_empty | ✓ PASSED |
| `tests/test_models_utils.py` | TestLoadNameGlossary::test_deduplicates_names | ✓ PASSED |
| `tests/test_models_utils.py` | TestBuildTranscriptionPrompt::test_returns_none_with_empty_glossary | ✓ PASSED |
| `tests/test_models_utils.py` | TestBuildTranscriptionPrompt::test_includes_names_and_language | ✓ PASSED |
| `tests/test_models_utils.py` | TestBuildTranscriptionPrompt::test_limits_to_first_20_names | ✓ PASSED |
| `tests/test_models_utils.py` | TestProtectRestoreTerms::test_roundtrip_with_known_name | ✓ PASSED |
| `tests/test_models_utils.py` | TestProtectRestoreTerms::test_multiple_names | ✓ PASSED |
| `tests/test_models_utils.py` | TestProtectRestoreTerms::test_name_not_in_text_unchanged | ✓ PASSED |
| `tests/test_models_utils.py` | TestProtectRestoreTerms::test_empty_text_unchanged | ✓ PASSED |
| `tests/test_models_utils.py` | TestProtectRestoreTerms::test_restore_with_empty_placeholders | ✓ PASSED |
| `tests/test_models_utils.py` | TestProtectRestoreTerms::test_longer_name_matched_first | ✓ PASSED |
| `tests/test_models_utils.py` | TestModelConfig::test_default_whisper_model_size | ✓ PASSED |
| `tests/test_models_utils.py` | TestModelConfig::test_default_device_preference | ✓ PASSED |
| `tests/test_models_utils.py` | TestModelConfig::test_load_flags_all_true_by_default | ✓ PASSED |
| `tests/test_models_utils.py` | TestTranscribeValidation::test_raises_without_whisper_model | ✓ PASSED |
| `tests/test_models_utils.py` | TestTranscribeValidation::test_returns_empty_for_empty_audio | ✓ PASSED |
| `tests/test_models_utils.py` | TestTranscribeValidation::test_raises_for_wrong_sample_rate | ✓ PASSED |
| `tests/test_models_utils.py` | TestTranslateValidation::test_raises_without_nllb_model | ✓ PASSED |
| `tests/test_models_utils.py` | TestTranslateValidation::test_returns_empty_for_whitespace_input | ✓ PASSED |
| `tests/test_models_utils.py` | TestSynthesizeValidation::test_raises_without_xtts_model | ✓ PASSED |
| `tests/test_models_utils.py` | TestSynthesizeValidation::test_returns_empty_float32_for_blank_text | ✓ PASSED |
| `tests/test_models_utils.py` | TestSynthesizeValidation::test_raises_when_speaker_wav_missing | ✓ PASSED |
| `tests/test_pipeline.py` | test_full_pipeline_emits_text | ✓ PASSED |
| `tests/test_pipeline.py` | test_full_pipeline_puts_audio_in_output_queue | ✓ PASSED |
| `tests/test_pipeline.py` | test_metrics_reported_with_correct_keys | ✓ PASSED |
| `tests/test_pipeline.py` | test_metrics_are_non_negative | ✓ PASSED |
| `tests/test_pipeline.py` | test_empty_transcription_skips_rest_of_pipeline | ✓ PASSED |
| `tests/test_pipeline.py` | test_empty_translation_skips_tts | ✓ PASSED |
| `tests/test_pipeline.py` | test_empty_tts_audio_not_put_in_queue | ✓ PASSED |
| `tests/test_pipeline.py` | test_transcription_error_calls_on_error | ✓ PASSED |
| `tests/test_pipeline.py` | test_translation_error_calls_on_error | ✓ PASSED |
| `tests/test_pipeline.py` | test_tts_error_calls_on_error | ✓ PASSED |
| `tests/test_pipeline.py` | test_worker_continues_after_error | ✓ PASSED |
| `tests/test_pipeline.py` | test_stop_event_exits_worker | ✓ PASSED |
| `tests/test_pipeline.py` | test_sentinel_none_exits_worker | ✓ PASSED |
| `tests/test_pipeline.py` | test_non_ndarray_segment_skipped | ✓ PASSED |
| `tests/test_pipeline.py` | test_empty_ndarray_segment_skipped | ✓ PASSED |
| `tests/test_pipeline.py` | test_two_segments_produce_two_text_results | ✓ PASSED |
| `tests/test_pipeline.py` | test_protect_terms_called_with_transcribed_text | ✓ PASSED |
| `tests/test_server.py` | test_health_returns_200 | ✓ PASSED |
| `tests/test_server.py` | test_health_returns_ok_status | ✓ PASSED |
| `tests/test_server.py` | test_health_reports_models_not_loaded_initially | ✓ PASSED |
| `tests/test_server.py` | test_health_reports_models_loaded_when_manager_set | ✓ PASSED |
| `tests/test_server.py` | test_ws_stop_without_start_closes_cleanly | ✓ PASSED |
| `tests/test_server.py` | test_ws_unknown_message_type_is_ignored | ✓ PASSED |
| `tests/test_server.py` | test_ws_start_reaches_ready_state | ✓ PASSED |
| `tests/test_server.py` | test_ws_start_error_propagated_to_client | ✓ PASSED |
| `tests/test_server.py` | test_ws_audio_before_start_is_ignored | ✓ PASSED |
| `tests/test_server.py` | test_ws_subtitle_disconnect_without_process_is_clean | ✓ PASSED |
| `tests/test_server.py` | test_ws_start_with_japanese_config | ✓ PASSED |
| `tests/test_server.py` | test_ws_start_with_unknown_lang_falls_back_to_english | ✓ PASSED |
| `tests/test_vad.py` | test_frame_samples_matches_config | ✓ PASSED |
| `tests/test_vad.py` | test_silence_frame_returns_none | ✓ PASSED |
| `tests/test_vad.py` | test_multiple_silence_frames_never_emit | ✓ PASSED |
| `tests/test_vad.py` | test_single_speech_frame_no_trailing_silence_returns_none | ✓ PASSED |
| `tests/test_vad.py` | test_speech_then_silence_emits_segment | ✓ PASSED |
| `tests/test_vad.py` | test_emitted_audio_is_float32 | ✓ PASSED |
| `tests/test_vad.py` | test_too_short_phrase_is_discarded | ✓ PASSED |
| `tests/test_vad.py` | test_max_duration_triggers_flush | ✓ PASSED |
| `tests/test_vad.py` | test_reset_clears_in_speech | ✓ PASSED |
| `tests/test_vad.py` | test_reset_clears_accumulated_frames | ✓ PASSED |
| `tests/test_vad.py` | test_reset_clears_silence_counter | ✓ PASSED |
| `tests/test_vad.py` | test_reset_calls_model_reset | ✓ PASSED |
| `tests/test_vad.py` | test_pre_speech_frames_included_in_segment | ✓ PASSED |
| `tests/test_vad.py` | test_speech_at_exact_threshold_is_speech | ✓ PASSED |
| `tests/test_vad.py` | test_speech_below_threshold_is_silence | ✓ PASSED |
| `tests/test_vad.py` | test_pre_speech_maxlen_matches_config | ✓ PASSED |
| `tests/test_vad.py` | test_silence_ms_accumulates_per_frame | ✓ PASSED |
| `tests/test_vad.py` | test_frame_samples_scales_with_sample_rate | ✓ PASSED |

---

## Frontend (TypeScript / Jest)

| Archivo | Test | Resultado |
|---------|------|-----------|
| `` | GET /api/profiles/[id] › returns 401 without auth | ✓ PASSED |
| `` | GET /api/profiles/[id] › returns 404 when profile not found | ✓ PASSED |
| `` | GET /api/profiles/[id] › returns 200 with file bytes when profile exists | ✓ PASSED |
| `` | DELETE /api/profiles/[id] › returns 401 without auth | ✓ PASSED |
| `` | DELETE /api/profiles/[id] › returns 200 and ok:true after deleting | ✓ PASSED |
| `` | field validation › returns 400 when body is empty | ✓ PASSED |
| `` | field validation › returns 400 when email is missing | ✓ PASSED |
| `` | field validation › returns 400 when password is missing | ✓ PASSED |
| `` | field validation › returns 400 for invalid email format | ✓ PASSED |
| `` | field validation › returns 400 for password shorter than 8 chars | ✓ PASSED |
| `` | authentication failures › returns 401 when the user does not exist | ✓ PASSED |
| `` | authentication failures › returns 401 when the password is wrong | ✓ PASSED |
| `` | authentication failures › queries the DB with the lowercased email | ✓ PASSED |
| `` | successful login › returns 200 | ✓ PASSED |
| `` | successful login › response contains user and token | ✓ PASSED |
| `` | successful login › returned user has id, email and username | ✓ PASSED |
| `` | successful login › returned token is a valid JWT for the user | ✓ PASSED |
| `` | successful login › does not expose the password hash in the response | ✓ PASSED |
| `` | successful login › compares password against the stored hash | ✓ PASSED |
| `` | GET /api/profiles › returns 401 without an Authorization header | ✓ PASSED |
| `` | GET /api/profiles › returns 401 with an invalid token | ✓ PASSED |
| `` | GET /api/profiles › returns 200 with a valid token | ✓ PASSED |
| `` | GET /api/profiles › returns a profiles array in the body | ✓ PASSED |
| `` | GET /api/profiles › returns only the authenticated user's profiles | ✓ PASSED |
| `` | GET /api/profiles › queries Prisma with the correct userId filter | ✓ PASSED |
| `` | GET /api/profiles › orders results by createdAt desc | ✓ PASSED |
| `` | POST /api/profiles › returns 401 without auth | ✓ PASSED |
| `` | POST /api/profiles › returns 400 when name is missing | ✓ PASSED |
| `` | POST /api/profiles › returns 400 when file is missing | ✓ PASSED |
| `` | POST /api/profiles › returns 400 for non-audio content type | ✓ PASSED |
| `` | POST /api/profiles › returns 200 and creates a profile for a valid wav upload | ✓ PASSED |
| `` | POST /api/profiles › saves the file to disk (calls writeFile) | ✓ PASSED |
| `` | field validation › returns 400 when all fields are missing | ✓ PASSED |
| `` | field validation › returns 400 when email is missing | ✓ PASSED |
| `` | field validation › returns 400 when username is missing | ✓ PASSED |
| `` | field validation › returns 400 when password is missing | ✓ PASSED |
| `` | field validation › returns 400 for an invalid email format | ✓ PASSED |
| `` | field validation › returns 400 for email without TLD | ✓ PASSED |
| `` | field validation › returns 400 for username shorter than 3 chars | ✓ PASSED |
| `` | field validation › returns 400 for username longer than 20 chars | ✓ PASSED |
| `` | field validation › returns 400 for password shorter than 8 chars | ✓ PASSED |
| `` | duplicate user detection › returns 409 when email is already registered | ✓ PASSED |
| `` | duplicate user detection › returns 409 when username is already taken | ✓ PASSED |
| `` | successful registration › returns 200 | ✓ PASSED |
| `` | successful registration › response body contains user and token | ✓ PASSED |
| `` | successful registration › returned user has id, email and username | ✓ PASSED |
| `` | successful registration › returned token is a valid JWT for the created user | ✓ PASSED |
| `` | successful registration › email is lowercased before storing | ✓ PASSED |
| `` | successful registration › does not store the plaintext password | ✓ PASSED |
| `` | signToken + verifyToken › round-trips a payload correctly | ✓ PASSED |
| `` | signToken + verifyToken › returns a non-empty JWT string | ✓ PASSED |
| `` | signToken + verifyToken › different payloads produce different tokens | ✓ PASSED |
| `` | signToken + verifyToken › throws on a completely invalid token | ✓ PASSED |
| `` | signToken + verifyToken › throws on a tampered signature | ✓ PASSED |
| `` | signToken + verifyToken › throws on an empty string | ✓ PASSED |
| `` | signToken + verifyToken › token payload contains sub and email claims | ✓ PASSED |
| `` | getAuthToken › extracts a Bearer token | ✓ PASSED |
| `` | getAuthToken › is case-insensitive for the Bearer prefix | ✓ PASSED |
| `` | getAuthToken › returns null when the authorization header is absent | ✓ PASSED |
| `` | getAuthToken › returns null for Basic auth scheme | ✓ PASSED |
| `` | getAuthToken › returns null for an empty authorization header | ✓ PASSED |
| `` | getAuthToken › returns null when Bearer has no token value | ✓ PASSED |
| `` | getAuthToken › preserves the token value exactly (including dots) | ✓ PASSED |
| `` | User — findUnique by email › queries by email field | ✓ PASSED |
| `` | User — findUnique by email › returns the user when found | ✓ PASSED |
| `` | User — findUnique by email › returns null when user is not found | ✓ PASSED |
| `` | User — findFirst with OR for duplicate detection › uses OR condition to check both email and username | ✓ PASSED |
| `` | User — create › creates with email, username and passwordHash | ✓ PASSED |
| `` | User — create › stores a bcrypt hash (not plaintext) | ✓ PASSED |
| `` | VoiceProfile — findMany › filters by userId | ✓ PASSED |
| `` | VoiceProfile — findMany › orders results by createdAt desc | ✓ PASSED |
| `` | VoiceProfile — findMany › returns an array of profiles | ✓ PASSED |
| `` | VoiceProfile — create › stores all required fields | ✓ PASSED |
| `` | VoiceProfile — create › accepts non-wav formats (webm, mp3, ogg) | ✓ PASSED |
| `` | VoiceProfile — update › can update sourceUrl after creation | ✓ PASSED |
| `` | session constants › AUTH_TOKEN_COOKIE has the expected name | ✓ PASSED |
| `` | session constants › AUTH_USER_COOKIE has the expected name | ✓ PASSED |
| `` | browser-only functions in SSR context › setAuthCookie returns undefined without throwing in SSR | ✓ PASSED |
| `` | browser-only functions in SSR context › clearAuthCookie returns undefined without throwing in SSR | ✓ PASSED |
| `` | browser-only functions in SSR context › getClientAuthToken returns null in SSR | ✓ PASSED |
