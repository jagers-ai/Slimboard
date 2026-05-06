# Slimboard

Slimboard is a mobile-first whiteboard memory app. Users sign in with Google,
capture or upload a whiteboard photo, and Gemini turns it into a searchable note
with the original image, raw transcription, Korean summary, keywords, and visual
context.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth, Postgres, and private Storage
- Gemini API through `@google/genai`
- Sharp for server-side analysis image generation

## Setup

1. Create a Supabase project.
2. Enable Google OAuth in Supabase Auth.
3. Run the SQL in `supabase/migrations/001_slimboard.sql`.
4. Copy `.env.example` to `.env.local` and fill in the values.
5. Install dependencies and run the app:

```bash
npm install
npm run dev
```

## Environment

`GEMINI_MODEL` defaults to `gemini-3-flash-preview`. Keep it configurable because
the Gemini 3 Flash model may move from preview to stable naming later.

The app stores original and analysis images in the private `whiteboard-images`
bucket. Browsers only keep temporary previews during capture/upload.
