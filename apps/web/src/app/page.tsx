import { auth } from "@/auth";
import { HomeView } from "@/components/HomeView";

export default async function HomePage() {
  const session = await auth();
  return <HomeView isSignedIn={Boolean(session?.user)} />;
}
