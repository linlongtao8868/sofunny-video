# Changelog

## 1.1.1 - 2026-07-29

### Added

- Added explicit HappyHorse `happyhorse-{ver}-video-edit` routing.
- Added `--task-id-file` to persist the task ID immediately after submission.
- Added local mock integration coverage for fast, mini, and HappyHorse video-edit flows.

### Changed

- Added `doubao-seed-2-0-fast` and `doubao-seed-2-0-mini` support.
- Fast and mini models now default to `720p` and reject unsupported `1080p`/`4k` resolutions before submission.
- Added nested proxy response URL extraction for `data.data.output.video_url`.
- Explicitly exit after successful download to avoid Node keep-alive hangs.
- Synchronized README, Skill instructions, and API reference documentation.

### Verification

- `node tests/mock-integration.js`
- Real fast and mini 480p text-to-video requests completed successfully.
