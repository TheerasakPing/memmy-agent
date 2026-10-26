-- Expand display-language choices without changing any existing settings or IDs.
-- The migration runner wraps this replacement in a transaction, so failures roll back.
-- All 22 columns and their constraints are retained, except for allowing th-TH.
CREATE TABLE app_settings_locale_v2 (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  user_mode TEXT NOT NULL DEFAULT 'unset'
    CHECK (user_mode IN ('unset', 'byok', 'account')),
  language TEXT NOT NULL DEFAULT 'system'
    CHECK (language IN ('system', 'zh-CN', 'en-US', 'th-TH')),
  theme TEXT NOT NULL DEFAULT 'system'
    CHECK (theme IN ('system', 'light', 'dark')),
  auto_update_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, default_launch_mode TEXT NOT NULL DEFAULT 'last'
    CHECK (default_launch_mode IN ('full', 'pet', 'last')), avatar TEXT NOT NULL DEFAULT 'memmy-default', skin TEXT NOT NULL DEFAULT 'default', active_uuid TEXT REFERENCES cloud_accounts(uuid), last_launch_mode TEXT NOT NULL DEFAULT 'full'
    CHECK (last_launch_mode IN ('full', 'pet')), task_done_notification_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (task_done_notification_enabled IN (0, 1)), notification_sound_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (notification_sound_enabled IN (0, 1)), menu_bar_icon_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (menu_bar_icon_enabled IN (0, 1)), auto_scan_known_agents INTEGER NOT NULL DEFAULT 1
    CHECK (auto_scan_known_agents IN (0, 1)), watch_file_changes INTEGER NOT NULL DEFAULT 1
    CHECK (watch_file_changes IN (0, 1)), auto_inject_skill INTEGER NOT NULL DEFAULT 0
    CHECK (auto_inject_skill IN (0, 1)), installation_id TEXT, stop_memory_service_on_exit INTEGER NOT NULL DEFAULT 0
  CHECK (stop_memory_service_on_exit IN (0, 1)), memory_byok_daily_limit_m INTEGER NOT NULL DEFAULT 10
  CHECK (memory_byok_daily_limit_m >= 0 AND memory_byok_daily_limit_m <= 99999), memory_byok_total_limit_m INTEGER NOT NULL DEFAULT 500
  CHECK (memory_byok_total_limit_m >= 0 AND memory_byok_total_limit_m <= 99999));

INSERT INTO app_settings_locale_v2 SELECT * FROM app_settings;
DROP TABLE app_settings;
ALTER TABLE app_settings_locale_v2 RENAME TO app_settings;
