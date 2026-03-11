# Redditors Client Guide

## What this app does

Redditors helps your team manage Reddit activity across multiple Reddit accounts.

It can:
- search for relevant Reddit posts based on each account's interests
- generate customer and employee comments
- send approval emails for comments that need review
- post approved comments from the correct Reddit accounts
- rotate account interests so search behavior does not stay stuck on one topic
- prevent the same account from commenting twice on the same Reddit post

This app is designed to stay running all day on a Windows virtual machine.

## Your normal daily workflow

### 1. Keep the app running

The app should stay open and running on the Windows VM throughout the day.

Why:
- the scheduler runs in the background
- approval emails are sent automatically
- campaign actions are created and executed during the campaign window

### 2. Review approval emails at 8:00 AM

Each morning, the app sends approval emails for comments that need human review.

By default, this includes:
- customer comments that mention the brand
- employee comments

The approval email time can be changed in the app settings.

### 3. Review comments inside the app

Open the `Campaign` page and go to `Approvals`.

For each approval card you can:
- expand the card to read the original Reddit post text
- see a media notice when the post includes images or video
- click `Visit Post` if you need the full Reddit context
- approve, edit and approve, or reject the comment

### 4. Run the campaign during the active window

The campaign uses one shared time window for the day.

Current default:
- start: `12:00 PM`
- end: `2:00 PM`

You can change both times in the `Campaign` page.

## Campaign setup

The `Campaign` page is the main control center.

### You can set:

- campaign start time
- campaign end time
- number of normal customer comments per customer account
- total number of customer brand mention comments
- total number of employee helpful comments
- total number of employee brand mention comments
- approval digest email time

### You can also use:

- `Enable Campaign` to allow the scheduler to run campaign work
- `Disable Campaign` to stop new campaign work from being created
- `Run Campaign Now` to run an immediate check when the campaign is enabled

Important:
- disabling the campaign stops new campaign items from being created
- it does not shut down the app
- it does not cancel jobs that are already running

## How comment rotation works

### Account rotation

The app rotates work across eligible accounts.

This means:
- customer brand mentions are spread across customer accounts
- employee helpful comments are spread across employee accounts
- employee brand mentions are spread across employee accounts

### Interest rotation

Each account can have a list of interests.

The list is used in order from left to right.
After a successful search/comment cycle, the used interest moves to the back of the queue.

This helps keep search behavior varied over time.

In the `Accounts` page you can:
- add interests
- remove interests
- reorder interests
- generate interests with AI

## Memory and learning

The app improves over time from approved edits.

How it works:
- when an approval is edited and approved, the app stores the final approved version
- the system can suggest reusable lessons from those edits
- approved memory entries are reused in future prompt generation

Use the `Campaign` -> `Memory` tab to:
- review pending learning suggestions
- promote a suggestion into reusable business memory
- dismiss a suggestion
- edit existing business memory
- create new business memory manually

## Accounts and roles

Each Reddit account should have one role:
- `customer`
- `employee`
- `inactive`

Use the `Accounts` page to manage:
- usernames and passwords
- interests
- role
- personality guidance
- proxy assignment

## Proxies

Use the `Proxy Manager` and `Proxy Assignment` pages to:
- add proxies
- review proxy status
- assign proxies to Reddit accounts

Recommended practice:
- keep one stable proxy per Reddit account when possible
- avoid changing proxies too often on active accounts

## Settings

Use the `Settings` page to manage:
- email delivery settings
- approval email time
- API keys already configured for the app
- other runtime settings

Do not delete or change keys unless you intend to replace them with working values.

## What the app prevents automatically

The current version includes these protections:
- one Reddit account should not comment twice on the same Reddit post
- search interests rotate instead of repeating the same first term forever
- approval cards show post context before you approve
- media posts show a visual notice so you know when opening the post may be necessary

## Recommended daily routine

1. Confirm the Windows VM is running.
2. Confirm the app is open and reachable.
3. Check approval emails at `8:00 AM`.
4. Review and approve comments in `Campaign` -> `Approvals`.
5. Confirm the campaign window is correct.
6. Keep the campaign enabled during the day.
7. Use logs if something looks off.

## If something is not working

### If approvals are not arriving

Check:
- email settings
- approval digest time
- recipient email addresses
- whether there are actually pending approval drafts

### If comments are not posting

Check:
- account login/cookies
- proxy assignment
- whether the target Reddit post is still commentable
- `System Logs` for the specific account/job

### If campaign volume looks too low

Check:
- campaign is enabled
- current time is inside the campaign window
- accounts have the correct roles
- accounts have interests configured
- there are enough eligible posts to act on

## Files that must stay with the app

These are required for the app to keep working correctly:
- `.env`
- `app/secret.key`
- the PostgreSQL database used by the app
- the configured frontend and backend source files

Do not delete or rotate these during normal use.

## Technical handoff notes

You do not need to program to use the app, but these points are important:
- the app is meant to run continuously on one Windows VM
- the backend uses Flask and PostgreSQL
- the frontend uses React
- keeping the backend and frontend config files intact is important
- if the app is moved to another machine, the environment settings and `app/secret.key` must move with it

## Best practice summary

- keep the app running all day
- review approvals every morning
- use `Visit Post` only when the post text in the app is not enough
- keep account roles and interests accurate
- change campaign settings from the `Campaign` page instead of asking someone to edit code
