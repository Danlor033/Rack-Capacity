// Point this at a Supabase project and the rack list and box presets become
// shared. Leave it as it is and the app still works -- it just keeps the lists
// in this browser instead.
const SUPABASE_URL = "";
const SUPABASE_KEY = "";

const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};
