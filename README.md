# WhatsApp CRM - Premium UI

A modern, premium WhatsApp CRM dashboard with interactive UI and database integration.

## 🚀 Features

- **Premium UI Design**: Gold, purple, and jewel-tone color scheme
- **Interactive Components**: Smooth animations and hover effects
- **WhatsApp Integration**: Automated lead management via WhatsApp Business API
- **Database Integration**: Supabase for data storage
- **Responsive Design**: Works on all devices

## 🛠️ Tech Stack

- **Frontend**: React 19.2.4 + Vite
- **Backend**: Node.js + Express
- **Database**: Supabase
- **Animations**: Framer Motion
- **Deployment**: Render

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/Lalsebastian/whatsapp-crm.git
cd whatsapp-crm
```

2. Install dependencies:
```bash
npm install
cd api && npm install
```

3. Set up environment variables (see `.env.example`)

## 🚀 Deployment to Render

### Option 1: Using Render Dashboard

1. **Connect your GitHub repository** to Render
2. **Create two services**:

   **API Service (Backend):**
   - Service Type: `Web Service`
   - Runtime: `Node`
   - Build Command: `cd api && npm install`
   - Start Command: `cd api && npm start`
   - Add environment variables:
     - `WHATSAPP_TOKEN`
     - `SUPABASE_URL`
     - `SUPABASE_ANON_KEY`
     - `VERIFY_TOKEN`
     - `NODE_ENV=production`

   **Static Site (Frontend):**
   - Service Type: `Static Site`
   - Build Command: `npm run build`
   - Publish Directory: `dist`

### Option 2: Using render.yaml

1. Push this repository to GitHub
2. Connect to Render and select "Deploy from render.yaml"
3. Set the environment variables in Render dashboard

## 🔧 Environment Variables

Copy `api/.env.example` to `api/.env` and fill in your values:

```env
WHATSAPP_TOKEN=your_whatsapp_token_here
VERIFY_TOKEN=your_verify_token_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

## 📱 WhatsApp Setup

1. Get your WhatsApp Business API credentials
2. Set the webhook URL to: `https://your-render-api-url.com/webhook`
3. Use the VERIFY_TOKEN for webhook verification

## 🗄️ Database Setup (Supabase)

1. Create a new Supabase project
2. Create these tables:

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

## 🎨 UI Customization

The premium UI system includes:
- Gold, purple, and jewel-tone color palette
- Interactive buttons with animations
- Glass morphism effects
- Responsive design

See `PREMIUM_UI_DESIGN.md` for detailed documentation.

## 📚 Documentation

- `QUICK_START.md` - Quick start guide
- `PREMIUM_UI_DESIGN.md` - Complete design system
- `REDESIGN_SUMMARY.md` - Implementation details
- `COLOR_SYSTEM.md` - Color palette reference

## 🏃‍♂️ Development

```bash
# Frontend
npm run dev

# Backend
cd api && npm run dev

# Build for production
npm run build
```

## 📄 License

MIT License
