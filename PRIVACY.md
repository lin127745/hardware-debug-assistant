# Privacy Policy – Hardware Debug Assistant

Last updated: 2026-11-26

Hardware Debug Assistant ("the app") is a Forge app for Atlassian Jira and Confluence, built by an independent developer.

## What data the app processes
- The summary and description of the Jira work item the user opens the agent from.
- Debug information the user types into Rovo chat (board details, measurements, root cause, fix).

## Where data is stored
All data stays inside the customer's own Atlassian site:
- Debug case data is stored as a Jira issue property (`hw-debug-case`) on the work item.
- Measurements and the closing summary are posted as Jira comments, and labels are added to the work item.
- Closed cases are published as pages in a Confluence space chosen by the customer (default key `HWKB`).

The app runs entirely on Atlassian's Forge platform. It has no external servers, makes no outbound network calls outside Atlassian, and does not copy, export, sell or share data with anyone.

## Personal data
The app does not store Atlassian account IDs or other personal data in any system of its own. Conversations in Rovo are processed by Atlassian under Atlassian's own terms and privacy policy.

## Removing data
Uninstalling the app stops all processing. Data the app wrote (issue properties, comments, labels, Confluence pages) remains in the customer's site and can be deleted with normal Jira and Confluence permissions.

## Contact
Questions or requests: open an issue at https://github.com/lin127745/hardware-debug-assistant/issues
