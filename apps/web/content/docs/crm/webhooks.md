---
title: Send board events to other tools with webhooks
description: Post signed JSON to your own URL or to Zapier, Make or n8n when items are created, change, change status or move, and check every delivery.
section: Automations
order: 40
---

A webhook sends a JSON message to a web address you choose each time something happens on a board. Use it to update another system, or to connect an automation hub such as Zapier, Make or n8n through a catch hook or incoming webhook URL.

## Before you start

- Only organization owners and admins can manage webhooks.
- You need an endpoint that accepts `POST` requests over `http` or `https`.

## Add a webhook

1. Open the board and select **Integrate** in the header, or open the **Integrations** tab of the board’s automations.
2. Under **Webhooks**, select **Add webhook**.
3. Enter the **Endpoint URL**, for example `https://example.com/hooks/kitstak`.
4. Under **Events**, pick what to send. See the table below.
5. Select **Create webhook**.
6. Copy the **New signing secret** with **Copy** and store it safely. It won’t be shown again.
7. Select **I’ve saved it**.

| Event | Code | When it is sent |
| --- | --- | --- |
| **Item created** | `item.created` | A new item is added to the board |
| **Column value changed** | `item.updated` | Any column value of an item changes |
| **Status changed** | `item.status_changed` | A status column changes label |
| **Item moved to group** | `item.moved` | An item moves to another group |

A status change sends both `item.updated` and `item.status_changed` if you picked both.

## Verify each delivery

Every delivery carries these headers:

```
content-type: application/json
x-kitstak-event: item.created
x-kitstak-delivery: <delivery id>
x-kitstak-signature: t=1730000000,v1=<signature>
```

To check that a delivery came from KitStak, compute an HMAC-SHA256 of the timestamp, a dot and the raw body (`t.rawBody`) with your signing secret, and compare it with `v1`. Reject timestamps older than five minutes. Retried deliveries also carry `x-kitstak-attempt`.

## Test and manage a webhook

Each webhook row shows its URL and its latest delivery.

| Action | What it does |
| --- | --- |
| Switch | **Pause** the webhook, or **Turn on** a paused one |
| **Send test** | Sends a `webhook.test` delivery. A toast says **Test delivered** or **Test delivery failed** |
| **Deliveries** | Opens the **Delivery log** with each attempt’s **Request body** and **Response** |
| **Rotate signing secret** | Makes a new secret. Update your endpoint with it |
| **Delete** | Stops deliveries immediately |

A deleted webhook’s secret can’t be recovered. A new webhook gets a new secret.

## Retries

- A delivery that fails is retried up to four more times: after 1 minute, 5 minutes, 30 minutes and 2 hours.
- After 15 failed deliveries in a row, the webhook is turned off. Fix the endpoint, then turn it on again.
- Deliveries only go out for changes that were saved. A change that was rolled back is never sent.
- Addresses on private, loopback or local networks are refused.

## Connect Zapier, Make or n8n

1. In the hub, create a catch hook (Zapier) or an incoming webhook module (Make, n8n), and copy its URL.
2. Add a KitStak webhook with that URL as the **Endpoint URL**.
3. Select **Send test** so the hub sees a sample message.

The **Integrations** tab also lists **In-app notifications** as **Built in**: the **Notify** automation action delivers to the KitStak inbox and bell with nothing to set up.

## Related pages

- [Build a custom automation](/docs/crm/build-an-automation)
- [Personal API tokens](/docs/crm/api-tokens)
- [Security settings and the audit log](/docs/crm/security-and-audit)
