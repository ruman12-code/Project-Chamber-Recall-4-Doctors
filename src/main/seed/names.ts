// Synthetic Bangladeshi names for practice data. No real person.
//
// Names are built from a given name and a family name rather than
// picked whole. An earlier version drew from a list of sixteen complete
// names, which meant seventeen different patients in a chamber of three
// hundred shared the identical full name - and the search screen and
// the merge tool were impossible to judge, because the deliberate
// duplicates were lost among accidental collisions.
//
// Some collision is realistic and wanted: a Bangladeshi chamber really
// does see several men called Md. Rafiq. Combining the two lists gives
// a few hundred combinations, so collisions happen occasionally instead
// of dominating.

export const MALE_GIVEN = [
  { bn: 'মোহাম্মদ', en: 'Mohammad' }, { bn: 'আব্দুল', en: 'Abdul' },
  { bn: 'শাহাদাত', en: 'Shahadat' }, { bn: 'নজরুল', en: 'Nazrul' },
  { bn: 'জাহাঙ্গীর', en: 'Jahangir' }, { bn: 'সাইফুল', en: 'Saiful' },
  { bn: 'মিজানুর', en: 'Mizanur' }, { bn: 'তানভীর', en: 'Tanvir' },
  { bn: 'আনোয়ার', en: 'Anwar' }, { bn: 'রুবেল', en: 'Rubel' },
  { bn: 'কামাল', en: 'Kamal' }, { bn: 'ফারুক', en: 'Faruk' },
  { bn: 'সোহেল', en: 'Sohel' }, { bn: 'ইমরান', en: 'Imran' },
  { bn: 'বিপ্লব', en: 'Biplob' }, { bn: 'দেলোয়ার', en: 'Delwar' },
  { bn: 'রেজাউল', en: 'Rezaul' }, { bn: 'শফিকুল', en: 'Shafiqul' },
];

export const MALE_FAMILY = [
  { bn: 'করিম', en: 'Karim' }, { bn: 'রফিক', en: 'Rafiq' },
  { bn: 'হোসেন', en: 'Hossain' }, { bn: 'ইসলাম', en: 'Islam' },
  { bn: 'আলম', en: 'Alam' }, { bn: 'রহমান', en: 'Rahman' },
  { bn: 'আহমেদ', en: 'Ahmed' }, { bn: 'মিয়া', en: 'Mia' },
  { bn: 'উদ্দিন', en: 'Uddin' }, { bn: 'হাসান', en: 'Hasan' },
  { bn: 'খান', en: 'Khan' }, { bn: 'সরকার', en: 'Sarkar' },
  { bn: 'চৌধুরী', en: 'Chowdhury' }, { bn: 'মোল্লা', en: 'Molla' },
];

export const FEMALE_GIVEN = [
  { bn: 'ফাতেমা', en: 'Fatema' }, { bn: 'রোকেয়া', en: 'Rokeya' },
  { bn: 'শিরিন', en: 'Shirin' }, { bn: 'নাসরিন', en: 'Nasrin' },
  { bn: 'সালমা', en: 'Salma' }, { bn: 'আয়েশা', en: 'Ayesha' },
  { bn: 'মমতাজ', en: 'Momtaz' }, { bn: 'রুবিনা', en: 'Rubina' },
  { bn: 'তাসলিমা', en: 'Taslima' }, { bn: 'হাসিনা', en: 'Hasina' },
  { bn: 'শাহনাজ', en: 'Shahnaz' }, { bn: 'জেসমিন', en: 'Jesmin' },
  { bn: 'সাবিনা', en: 'Sabina' }, { bn: 'নূরজাহান', en: 'Nurjahan' },
  { bn: 'মরিয়ম', en: 'Mariam' }, { bn: 'সুরাইয়া', en: 'Suraiya' },
];

export const FEMALE_FAMILY = [
  { bn: 'বেগম', en: 'Begum' }, { bn: 'খাতুন', en: 'Khatun' },
  { bn: 'আক্তার', en: 'Akter' }, { bn: 'সুলতানা', en: 'Sultana' },
  { bn: 'সিদ্দিকা', en: 'Siddika' }, { bn: 'বানু', en: 'Banu' },
  { bn: 'পারভীন', en: 'Parvin' }, { bn: 'ইয়াসমিন', en: 'Yasmin' },
  { bn: 'আরা', en: 'Ara' }, { bn: 'নাহার', en: 'Nahar' },
];

export const AREAS = [
  { bn: 'মিরপুর, ঢাকা', en: 'Mirpur, Dhaka' }, { bn: 'সাভার', en: 'Savar' },
  { bn: 'নারায়ণগঞ্জ', en: 'Narayanganj' }, { bn: 'গাজীপুর', en: 'Gazipur' },
  { bn: 'কেরানীগঞ্জ', en: 'Keraniganj' }, { bn: 'টঙ্গী', en: 'Tongi' },
  { bn: 'উত্তরা, ঢাকা', en: 'Uttara, Dhaka' }, { bn: 'ডেমরা', en: 'Demra' },
  { bn: 'যাত্রাবাড়ী, ঢাকা', en: 'Jatrabari, Dhaka' }, { bn: 'আশুলিয়া', en: 'Ashulia' },
];
