# Permissions

Step 05. Every permission LifeDots will ever ask for, why it needs it, and what the user sees when it asks.

**The justification paragraphs below are the ones to paste into the Chrome Web Store dashboard at step 09.** They are written for a reviewer, not for us — each one names the feature the permission serves and says what the extension does *not* do with it.

---

## The set

| Permission | Install warning the user sees | Added in |
|---|---|---|
| `storage` | *none* | step 04 ✅ |
| `alarms` | *none* | v0 — midnight rollover |
| `idle` | *none* | v0 — pause when away |
| `notifications` | **"Display notifications."** | v1 — the drift line |
| `optional_host_permissions` | *none at install* — asked when the user names a site | v1 — setup |

**At install, the dialog says one thing: "Display notifications."** Everything else is either warning-free or deferred until the user actively chooses a site.

## The one we are not asking for

**`tabs` — deliberately not requested.** It is the permission that prints **"Read your browsing history"** in the install dialog, and the research is unambiguous that this line is a bounce point for an unknown developer.

It turns out not to be necessary. From Chrome's own documentation:

> "Host permissions allow an extension to read and query a matching tab's four sensitive `tabs.Tab` properties." — `url`, `pendingUrl`, `title`, `favIconUrl`

So with host access to `leetcode.com`, `chrome.tabs.get()` returns the address of a LeetCode tab. On any site the user did not name, the address simply comes back empty — **and that is all LifeDots needs to know.** "Not on the work" is the only fact the drift detector requires; it never needs to learn *where* you went.

The restriction is a feature, not a workaround: the extension is *structurally incapable* of seeing the rest of your browsing, rather than merely promising not to look.

> ⚠️ **To verify in v0:** that `chrome.tabs.onActivated` fires without the `tabs` permission (its payload carries only `tabId` and `windowId`, no address, so it should). If it turns out to be gated, the fallback is polling `chrome.tabs.query({active: true})` on the alarm, which is coarser but still needs no `tabs` permission. Prove this before building the stopwatch on top of it.

---

## Justifications — paste these verbatim at step 09

### Single purpose

> LifeDots tracks how much time the user spends on websites they have chosen themselves, in order to mark whether one daily habit was done. It does one thing: count minutes on the user's own list of sites, and show that as a dot per day.

### `storage`

> LifeDots stores the user's single habit, the site patterns they chose for it, the minutes counted against those sites each day, and which days reached the daily target. All of this is written to `chrome.storage.local` on the user's own device. None of it is transmitted anywhere — the extension makes no network requests of any kind and has no server, no account and no analytics.

### `alarms`

> One repeating alarm fires at local midnight to close out the day: the day's minute total is finalised, the dot for that date is written, and the counter resets to zero for the new day. Without it, a browser left running overnight would continue adding the next day's minutes to the previous day's total, and the recorded history would be wrong.

### `idle`

> LifeDots counts only time the user is actually present. The idle API reports when the keyboard and mouse have been inactive, so the timer pauses and a tab left open on screen while the user is away is not counted as work. This is what makes the recorded minutes meaningful rather than simply a measure of how long a tab happened to be open.

### `notifications`

> During a focus session, if the user moves away from the sites they chose for their habit, LifeDots shows a single notification telling them so, and then stays quiet. Notifications are used for nothing else: there is no marketing, no promotional content, no daily reminder to come back, and no notification is sent when a session is not running.

### `optional_host_permissions`

> During setup the user names the websites their habit happens on — for example `leetcode.com` for a coding-practice habit. LifeDots requests access to those specific sites **at that moment**, not at install time, and only to the sites the user typed. The access is used for two things: reading the address of the active tab so that elapsed time can be attributed to the correct site, and drawing a small character overlay on those same pages. LifeDots never reads page content, never records browsing history, and never requests access to any site the user has not explicitly named.

---

## The manifest

Permissions are added **when the feature that needs them is built**, never in advance. A scaffold that requests `notifications` before anything can notify is asking for an install warning in exchange for nothing, and a reviewer will ask why an unused permission is there.

Current state (step 04):

```json
"permissions": ["storage"]
```

Planned, as v0 and v1 land:

```json
"permissions": ["storage", "alarms", "idle", "notifications"],
"optional_host_permissions": ["*://*/*"]
```

### About that `*://*/*`

`optional_host_permissions` has to be declared broadly, because we cannot know in advance which sites a user will name. It does **not** grant anything — it only declares which origins the extension is *allowed to ask for later*, and it produces no install-time warning. The actual grant happens one site at a time, through `chrome.permissions.request()`, with Chrome's own prompt, in response to the user typing that site.

Be aware it will draw a reviewer's eye, which is exactly why the justification above leads with *when* it is requested rather than *what* it covers.

## Rules that do not change

- **Never `<all_urls>` in `host_permissions`.** Permission breadth and, worse, permission *escalation* in an update are documented rage-uninstall triggers — one extension in the research lost multi-year users in a single release by adding it.
- **Never request a permission before the feature exists.**
- **Never widen an existing permission in an update.** If a future feature genuinely needs more, ask for it at runtime, with a reason, from a user who already trusts the thing.
- **Never read page content.** Not in v1, not in Pro. It is the difference between "cannot see your browsing" and "promises not to look", and it is the only genuinely defensible claim this product has.
