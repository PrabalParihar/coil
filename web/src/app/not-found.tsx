import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-semibold">Coil</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">This page is not on Coil.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        That address does not match a Coil page. This app runs on Mezo testnet. The contracts are not audited.
      </p>
      <Link href="/" className="btn-btc mt-6 inline-flex min-h-11 w-fit items-center rounded-lg px-4 text-sm font-medium">
        Back to Coil
      </Link>
    </main>
  );
}
