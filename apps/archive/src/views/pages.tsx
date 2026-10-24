/**
 * Full pages that don't belong to one area: login, messages and not found.
 */
import type { AuthState } from '../auth/auth.ts';
import { BareLayout, Layout } from './layout.tsx';

export function LoginPage(props: { next: string; error?: string | undefined }) {
  const { next, error } = props;
  return (
    <BareLayout title="Log in">
      <div class="w-full max-w-sm">
        <div class="card panel w-full rounded-3xl">
          <form class="card-body gap-4" method="post" action="/login">
            <div>
              <h1 class="card-title text-2xl">Stream Archive</h1>
              <p class="text-base-content/60 text-sm">Enter the password to continue.</p>
            </div>
            <input type="hidden" name="next" value={next} />
            <label class="input w-full">
              <svg
                class="size-4 opacity-60"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <input
                class="grow"
                type="password"
                name="password"
                placeholder="Password"
                aria-label="Password"
                required
                autofocus
                autocomplete="current-password"
              />
            </label>
            {error && (
              <div role="alert" class="alert alert-error alert-soft text-sm">
                {error}
              </div>
            )}
            <button class="btn btn-primary w-full" type="submit">
              Log in
            </button>
          </form>
        </div>
      </div>
    </BareLayout>
  );
}

/** A short message with a way back, e.g. a failed upload. */
export function MessagePage(props: { auth: AuthState; title: string; message: string }) {
  return (
    <Layout title={props.title} auth={props.auth}>
      <div class="panel mx-auto max-w-md rounded-3xl p-6">
        <h1 class="text-xl font-bold">{props.title}</h1>
        <p class="text-base-content/70 mt-2">{props.message}</p>
        <button class="btn btn-ghost mt-4" type="button" onclick="history.back()">
          ← Back
        </button>
      </div>
    </Layout>
  );
}

export function NotFoundPage({ auth }: { auth: AuthState }) {
  return (
    <Layout title="Not found" auth={auth}>
      <div class="panel mx-auto max-w-md rounded-3xl p-6">
        <h1 class="text-xl font-bold">Not found</h1>
        <p class="text-base-content/70 mt-2">There's nothing here, or it's been archived.</p>
        <a class="btn btn-ghost mt-4" href="/">
          ← Back to the archive
        </a>
      </div>
    </Layout>
  );
}
