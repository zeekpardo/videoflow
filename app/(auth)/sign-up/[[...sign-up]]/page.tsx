import { SignUp } from "@clerk/nextjs";
import { AppLogo } from "@/components/app-logo";
export default function Page() { return <main className="grid min-h-screen place-items-center bg-[#f6f8fc] p-4"><div className="flex flex-col items-center gap-6"><AppLogo href="/" /><SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/record" /></div></main>; }
