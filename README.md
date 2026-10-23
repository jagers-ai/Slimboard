# Slimboard

Slimboard is a mobile-first whiteboard memory app. Users sign in with Google,
capture or upload a whiteboard photo, and the OpenAI API turns it into a searchable note
with the original image, raw transcription, Korean summary, keywords, and visual
context.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth, Postgres, and private Storage
- OpenAI Responses API (GPT-6 Astra / Light)
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

The server uses `OPENAI_API_KEY`. `SLIMBOARD_OPENAI_MODEL` defaults to
`gpt-6-astra`, and `SLIMBOARD_OPENAI_REASONING_EFFORT` defaults to `low`.

The app stores original and analysis images in the private `whiteboard-images`
bucket. Browsers only keep temporary previews during capture/upload.

## Local camera experiment

See [OpenAI API setup and phone testing](docs/openai-api.md). `npm run lab:start`
runs the camera screen at `/lab/codex` with an existing API key. The normal app
uses the same API analysis. The old Codex OAuth experiment is archived.
