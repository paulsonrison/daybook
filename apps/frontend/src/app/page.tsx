import { ServiceStatus } from '@/features/service-status/service-status';
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-20">
      <header className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-widest">
          Daybook · Foundation
        </p>
        <h1 className="text-4xl font-bold">Newspaper agency management</h1>
        <p className="text-lg text-slate-600">
          Next.js frontend, GraphQL backend and a shared Storybook UI package
          are ready for feature development.
        </p>
      </header>
      <ServiceStatus />
      <p className="text-sm text-slate-600">
        This is the initialization screen. Product screens and workflows will
        follow the documented user stories and Figma designs.
      </p>
    </main>
  );
}
