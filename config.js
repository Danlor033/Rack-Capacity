// Point this at a Supabase project and the rack list and box presets become
// shared. Leave it as it is and the app still works -- it just keeps the lists
// in this browser instead.
const SUPABASE_URL = "https://zvzeojcdjafzqunzladl.supabase.co";
const SUPABASE_KEY = "sb_publishable_ycQbkzbjsiDtitEhZIjvMQ_fGdch1Qp";

const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};
