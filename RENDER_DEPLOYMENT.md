# Render Deployment Guide

## Setup Instructions for WhatsApp CRM on Render

This guide will help you deploy the WhatsApp CRM to Render.com (replacing Vercel).

### Step 1: Prepare Your Repository

1. Make sure all changes are committed to GitHub:
```bash
git add .
git commit -m "Configure for Render deployment"
git push
```

### Step 2: Connect to Render

1. Go to [render.com](https://render.com)
2. Sign up or log in with your GitHub account
3. Click "New +" → "Blueprint" (or manual services)

### Step 3: Option A - Deploy with render.yaml (Recommended)

If using `render.yaml`:

1. Click "New +" → "Blueprint"
2. Connect your GitHub repository
3. Render will automatically read `render.yaml`
4. Click "Create Resources"
5. Skip to Step 4 (Environment Variables)

### Step 3: Option B - Manual Service Creation

Create API Service:

1. Click "New +" → "Web Service"
2. Connect your GitHub repository
3. Set these values:
   - **Name**: `whatsapp-crm-api`
   - **Root Directory**: `api`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Click "Create Web Service"

Create Frontend Service:

1. Click "New +" → "Static Site"
2. Connect your GitHub repository
3. Set these values:
   - **Name**: `whatsapp-crm-frontend`
   - **Root Directory**: (leave empty)
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
4. Click "Create Static Site"

### Step 4: Set Environment Variables

For the API Service:

1. Go to your API service dashboard
2. Click "Environment" in the left sidebar
3. Add these environment variables:
   - `NODE_ENV` = `production`
   - `WHATSAPP_TOKEN` = your_token
   - `SUPABASE_URL` = your_supabase_url
   - `SUPABASE_ANON_KEY` = your_supabase_key
   - `VERIFY_TOKEN` = your_verify_token
   - `PORT` = `3000` (auto-set by Render, but good to be explicit)

### Step 5: Configure WhatsApp Webhook

1. Get your API service URL from Render dashboard (e.g., `https://whatsapp-crm-api.onrender.com`)
2. In your WhatsApp Business API settings:
   - Set Webhook URL: `https://whatsapp-crm-api.onrender.com/webhook`
   - Set Verify Token: (use the same `VERIFY_TOKEN` you set in environment variables)

### Step 6: Database Setup (Supabase)

Create these tables in your Supabase project:

**leads table:**
```sql
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  name TEXT,
  phone TEXT,
  business_type TEXT,
  service_type TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**sessions table:**
```sql
CREATE TABLE sessions (
  phone TEXT PRIMARY KEY,
  state TEXT DEFAULT 'IDLE',
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Webhook URL Structure

- **Main Webhook**: `https://your-api-url.onrender.com/webhook`
- **Health Check**: `https://your-api-url.onrender.com/health`

### Useful Render Features

- **Auto-deploys**: Automatic deployment on every git push
- **Environment secrets**: Render stores sensitive data securely
- **Custom domains**: You can connect your own domain
- **Monitoring**: Built-in logs and metrics

### Troubleshooting

**API not responding?**
- Check logs in Render dashboard: Dashboard → Logs
- Verify environment variables are set correctly
- Check that database credentials are valid

**Webhook not receiving messages?**
- Verify webhook URL is correct in WhatsApp settings
- Check API logs for errors
- Test webhook using WhatsApp webhook test feature

**Database connection issues?**
- Verify SUPABASE_URL and SUPABASE_ANON_KEY
- Check Supabase project is active
- Ensure tables are created
- Check network access in Supabase settings

### Important Notes

- Do NOT commit `.env` files to GitHub
- Use `render.yaml` for consistent deployments
- Keep API and frontend separate services
- Monitor logs regularly for issues
- Set up email alerts for service failures

### Next Steps

1. Push changes to GitHub
2. Connect to Render
3. Deploy using render.yaml or manual services
4. Set environment variables
5. Configure WhatsApp webhook
6. Test with WhatsApp messages

---

**Support**: Visit [render.com/docs](https://render.com/docs) for more information
