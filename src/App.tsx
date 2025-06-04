import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { invoke } from "src/utils/invokeEdgeFunction";
import LoginPage from "./pages/LoginPage";
import PackageSetupPage from "./pages/PackageSetupPage";
import PackageInputPage from "./pages/PackageInputPage";
import ManualOrderingPage from "./pages/ManualOrderingPage";
import DeliveryPage from "./pages/DeliveryPage";
import CompletedPage from "./pages/CompletedPage";
import SubscriptionInfoPage from "./pages/SubscriptionInfoPage";
import SettingsPage from "./pages/SettingsPage";
import StatisticsPage from "./pages/StatisticsPage";
import HowToUsePage from "./pages/HowToUsePage";
import { UserProfile } from "src/types";

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentPage, setCurrentPage] = useState("login");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const syncUserProfile = async () => {
      if (user?.id) {
        console.log("🔁 Chamando função sync_user_profile...");
        await invoke("sync_user_profile", {});
      }
    };

    syncUserProfile();
  }, [user?.id]);

  if (!user) return <LoginPage />;

  switch (currentPage) {
    case "packageSetup":
      return <PackageSetupPage setCurrentPage={setCurrentPage} />;
    case "packageInput":
      return <PackageInputPage setCurrentPage={setCurrentPage} />;
    case "manualOrdering":
      return <ManualOrderingPage setCurrentPage={setCurrentPage} />;
    case "delivery":
      return <DeliveryPage setCurrentPage={setCurrentPage} />;
    case "completed":
      return <CompletedPage setCurrentPage={setCurrentPage} />;
    case "subscriptionInfo":
      return <SubscriptionInfoPage setCurrentPage={setCurrentPage} />;
    case "settings":
      return <SettingsPage setCurrentPage={setCurrentPage} />;
    case "statistics":
      return <StatisticsPage setCurrentPage={setCurrentPage} />;
    case "howToUse":
      return <HowToUsePage setCurrentPage={setCurrentPage} />;
    default:
      return <LoginPage setCurrentPage={setCurrentPage} />;
  }
}

export default App;
