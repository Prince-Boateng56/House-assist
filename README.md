# House Assist

House Assist is a single-page UI with a Flask API and Supabase Postgres database.

## Create the Supabase tables

Open the Supabase project’s SQL Editor, paste in [`supabase/schema.sql`](supabase/schema.sql), and run it. It creates empty tables in the `house_assist` schema; it does not alter existing tables in `public` or add sample helpers or demo users. Row Level Security is enabled because the app accesses the database only through its backend.

## Run locally

The repository uses a local `.env` file for the private database connection string. It is ignored by Git. Install the requirements, then set a private admin PIN in PowerShell and start the server:

```powershell
python -m pip install -r backend/requirements.txt
$env:HOUSE_ASSIST_ADMIN_PIN = "choose-a-private-admin-code"
python backend/app.py
```

Open <http://127.0.0.1:5000>. Keep the database connection string and admin PIN on the server; never put them in browser code or commit them to the project. Run [`supabase/schema.sql`](supabase/schema.sql) once in the Supabase SQL Editor to create the tables.

The API stores accounts, helper listings, sessions, hires, payment confirmations, ratings, profile preferences, and branding in Supabase. Payment confirmations are self-reported; this app does not process payments.

Authentication uses Supabase Auth for passwords and the private `house_assist` schema for application profiles and roles. Run the updated schema after pulling changes. Accounts created before this authentication change are legacy records and must be recreated or have their password reset before they can use Supabase Auth.

Password accounts require a valid email address, username, password and role-specific profile details. The real email is stored in Supabase Auth and in `house_assist.users`; login requires both the username and the matching email. For Google signup or sign-in, the selected region is the only information required before pressing the Google button. Google accounts use the email returned by Google; new Google users choose their House Assist username and any remaining role-specific profile details after Google authentication.

### Enable Google sign-in

1. In Supabase, open **Authentication → Providers → Google** and enable Google.
2. In Google Cloud Console, create a **Web application** OAuth client.
3. Add this Supabase callback URL to the Google OAuth client’s authorized redirect URIs:
   `https://svhccqudltmkeninethu.supabase.co/auth/v1/callback`
4. Copy the Google client ID and client secret into the Supabase Google provider settings.
5. In Supabase **Authentication → URL Configuration**, set the Site URL to `https://house-assist-omega.vercel.app` and add these redirect URLs:
   - `https://house-assist-omega.vercel.app`
   - `http://127.0.0.1:5000`
6. Deploy the application. The auth screen’s **Continue with Google** button preserves the selected customer/helper role and collects the required profile details for new accounts.

Google OAuth configuration is managed in Supabase and Google Cloud; never put the Google client secret in the repository or browser code.

If Google returns `server_error`, `unexpected_failure`, or `Unable to exchange external code`, the failure is in the provider configuration before the application callback runs. Verify that:

- The Google OAuth client is a **Web application** client.
- Its authorized redirect URI is exactly `https://svhccqudltmkeninethu.supabase.co/auth/v1/callback`.
- The Google client ID and client secret in Supabase exactly match that same Google client.
- The Supabase Site URL and redirect allow-list contain `https://house-assist-omega.vercel.app` with no trailing path or query string.
- If the Google OAuth app is in testing mode, the signing-in Google account is listed as a test user.

After changing the provider credentials, retry in a private browser window so an old Google authorization code is not reused.

## Deploy to Vercel

The static frontend is served by Vercel and the Flask API is exposed as the Python function in [`api/index.py`](api/index.py). In the Vercel project settings, add these environment variables:

- `SUPABASE_DB_URL`
- `HOUSE_ASSIST_ADMIN_PIN`

Use the same Supabase connection string and admin PIN as the local deployment. Never commit `.env` or expose the database URL in browser code.

Import the repository into Vercel and deploy from the repository root. After deployment, verify `https://your-domain.vercel.app/api/health`, then run [`supabase/schema.sql`](supabase/schema.sql) in Supabase if the tables are not already created.
