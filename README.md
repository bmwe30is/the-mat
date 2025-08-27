# The Mat - Next.js + Prisma + Supabase Project

A full-stack application built with Next.js, Prisma ORM, and Supabase.

## Features

- ⚡ Next.js 14 with App Router
- 🎨 TailwindCSS for styling
- 🗄️ Prisma ORM with PostgreSQL
- 🔐 Supabase for authentication and real-time features
- 📱 Responsive design
- 🚀 TypeScript support

## Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account
- PostgreSQL database (via Supabase)

## Getting Started

### 1. Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd the-mat
npm install
```

### 2. Environment Setup

Copy the `.env` file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Update the `.env` file with your actual values:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Database Configuration
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Environment
NODE_ENV=development
```

### 3. Database Setup

Generate Prisma client and run migrations:

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio to view/edit data
npx prisma studio
```

### 4. Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Project Structure

```
src/
├── app/                 # Next.js App Router
│   ├── api/            # API routes
│   └── (routes)/       # Page routes
├── lib/                # Utility libraries
│   ├── prisma.ts       # Prisma client
│   └── supabase.ts     # Supabase client
├── components/         # Reusable components
└── types/             # TypeScript type definitions

prisma/
├── schema.prisma       # Database schema
└── migrations/         # Database migrations
```

## API Endpoints

- `GET /api/users` - Fetch all users
- `POST /api/users` - Create a new user

## Database Models

The project includes example models for `User` and `Post`. Modify the `prisma/schema.prisma` file to add your own models.

## Supabase Integration

This project uses Supabase for:

- Database hosting (PostgreSQL)
- Authentication
- Real-time subscriptions
- File storage (if needed)

## Deployment

1. Set up your production environment variables
2. Run `npm run build`
3. Deploy to your preferred hosting platform (Vercel, Netlify, etc.)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT
