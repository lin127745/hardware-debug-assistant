# Hardware Debug Assistant

A Rovo agent for Jira that guides hardware engineers through structured, bottom-up board debugging, logs every measurement on the work item, surfaces similar past cases, and publishes each solved case to a Confluence knowledge base.

Built on Atlassian Forge for Codegeist 2026 (Apps for Specialized Industries).

## What it does
- **Guided debugging**: walks through Intake → Visual inspection → Power → Clock → Reset & boot → Debug interface → Firmware & communication → Intermittent, asking for one measurement at a time with test point, expected value and instrument.
- **Measurement log**: each result is saved on the work item and posted as a comment table with PASS / FAIL / INCONCLUSIVE status.
- **Similar cases**: searches resolved `hw-debug` work items and cites their root causes and fixes.
- **Knowledge base**: closing a case writes a Confluence report page (summary, symptom, root cause, fix, verification, full measurement log) and labels both the page and the work item.

## Install
1. Open the installation link and install on **Jira** (required), then on **Confluence** on the same site.
2. Open any Jira work item, open Rovo chat, pick **Hardware Debug Assistant**, and say "Start debugging this board".

The knowledge base space (key **`HWKB`**) is created automatically the first time a case is closed. To use a different space, tell the agent its key when closing the case.

## Development
```
npm install
forge deploy -e development
forge install --site <your-site>.atlassian.net --product jira -e development
forge install --site <your-site>.atlassian.net --product confluence -e development
```

## Privacy
See [PRIVACY.md](PRIVACY.md). Support: [GitHub Issues](https://github.com/lin127745/hardware-debug-assistant/issues).
