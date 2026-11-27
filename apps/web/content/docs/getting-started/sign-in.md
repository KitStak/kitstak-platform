---
title: Sign in to KitStak
description: Sign in once with a password, an emailed code, Google or Microsoft, and open every app. Learn about lockout, sessions and signing out.
section: Your account
order: 10
---

KitStak has one sign in page, in the Portal. It is the only place with every way in: a password, a code by email, Google and Microsoft. When you open a CRM, WMS, Projects or Pulse link while signed out, the app sends you to this page and back to the page you asked for.

## Sign in with your password

1. Go to the sign in page. It reads **Welcome back** and **Sign in to open your KitStak apps.**
2. Type your **Work email** and **Password**.
3. Leave **Keep me signed in** on, or turn it off on a shared computer.
4. Select **Sign in**. The button reads **Signing you in…** and then you see **Opening your KitStak apps**.

You land on the page you were going to, or on the Portal home page.

## Sign in with a code by email

Use this if you never set a password, or if you would rather not type it.

1. Type your **Work email**.
2. Under **Sign in**, next to **Or skip the password.**, select **Email me a code instead**.
3. The screen changes to **Check your email**: **Enter the 6 digit code to sign in. No password needed.** It also says **If that address has a KitStak account, a code is on its way.**
4. Type the code from the email. The screen says the code works for 10 minutes.
5. Select **Sign in**.

If no email arrives, select **Send a new code**. To go back, select **Use my password instead**. A page refresh keeps the code step open for the same address, and the code already mailed still works.

## Sign in with Google or Microsoft

When they are offered, the page shows **Continue with Google** and **Continue with Microsoft** above **or use your email**. Select one and finish in the window that opens.

| Message | What it means |
| --- | --- |
| This email already has a KitStak account. Sign in with your email and password. | Sign in the usual way first. |
| You closed the sign in window. Try again, or use your email. | The window was closed before it finished. |
| We could not find an account for that sign in. Create one with your email. | No KitStak account uses that address yet. |
| That sign in did not work. Try again, or use your email. | Something went wrong on the other side. Try again. |

## When sign in fails

| Message | What to do |
| --- | --- |
| Enter a valid email address. | Check the address for typos. |
| Enter your password. | Type your password, or use a code instead. |
| That email and password do not match. Check them and try again. | Check both. If you forgot the password, select **Forgot password?**. |
| Too many tries. Wait 1 minute and try again. | Wait the time shown, then try again. |

### Account lockout

After 5 wrong passwords for the same email, the account is locked for 15 minutes. During that time even the right password is refused. The message stays the same as for a wrong password, so nobody can use the page to learn whether an account exists or is locked.

To get back in at once, reset your password with **Forgot password?**. A successful reset clears the lock. See [Reset or change your password](/docs/getting-started/reset-your-password). You can also sign in with **Email me a code instead**.

## Notices on the sign in page

| Notice | Why you see it |
| --- | --- |
| You have been signed out. | You selected **Sign out**. |
| Your password is changed. Sign in with your new password. | You reset your password. |
| You were signed out because you were away for a while. Sign in to pick up where you left off. | The WMS signed you out after a long time away. |

## Sessions and signing out

- One sign in covers every app. Open any app from the Portal with no second sign in.
- To sign out, open the **Account menu** (your initials in the top bar) and select **Sign out**. You can also pick **Sign out** in the command palette.
- When your password is reset, every session you have is ended, on every device and in every app.
- A session that has ended is refused on the very next page you open, in every app.
- If a WMS admin deactivates you, every session you have ends and you cannot sign in to any app until they activate you again. When they do, you set a new password.

## Related pages

- [Password rules](/docs/getting-started/password-rules)
- [Manage your account](/docs/getting-started/my-account)
- [Switch between apps with one sign in](/docs/getting-started/switch-apps)
- [Security in KitStak](/docs/getting-started/security)
