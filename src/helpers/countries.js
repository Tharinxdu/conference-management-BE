// src/helpers/countries.js
//
// Same country list used by the registration page dropdown.
// Kept here as plain CommonJS so both the registration and gala backends can
// require() it. If you later consolidate registration-helper.js, point it at
// this file too so there is only one list to maintain.

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "American Samoa", "Andorra", "Angola",
  "Antigua and Barbuda", "Argentina", "Armenia", "Aruba", "Australia", "Austria",
  "Azerbaijan", "Bahamas, The", "Bahrain", "Bangladesh", "Barbados", "Belarus",
  "Belgium", "Belize", "Benin", "Bermuda", "Bhutan", "Bolivia",
  "Bosnia and Herzegovina", "Botswana", "Brazil", "British Virgin Islands",
  "Brunei Darussalam", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde",
  "Cambodia", "Cameroon", "Canada", "Cayman Islands", "Central African Republic",
  "Chad", "Channel Islands", "Chile", "China", "Colombia", "Comoros",
  "Congo, Dem. Rep", "Congo, Rep.", "Costa Rica", "Croatia", "Cuba", "Curaçao",
  "Cyprus", "Czechia", "Côte d'Ivoire", "Denmark", "Djibouti", "Dominica",
  "Dominican Republic", "Ecuador", "Egypt, Arab Rep.", "El Salvador",
  "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Faroe Islands", "Fiji",
  "Finland", "France", "French Polynesia", "Gabon", "Gambia, The", "Georgia",
  "Germany", "Ghana", "Gibraltar", "Greece", "Greenland", "Grenada", "Guam",
  "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti",
  "Hong Kong SAR, China", "Honduras", "Hungary", "Iceland", "India", "Indonesia",
  "Iran, Islamic Rep.", "Iraq", "Ireland", "Isle of Man", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati",
  "Korea, Dem. People's Rep", "Korea, Rep.", "Kosovo", "Kuwait", "Kyrgyz Republic",
  "Lao PDR", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
  "Lithuania", "Luxembourg", "Macao SAR, China", "Madagascar", "Malawi",
  "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania",
  "Mauritius", "Mexico", "Micronesia, Fed. Sts.", "Moldova", "Monaco", "Mongolia",
  "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
  "Netherlands", "New Caledonia", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Macedonia", "Northern Mariana Islands", "Norway", "Oman", "Pakistan",
  "Palau", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Puerto Rico", "Qatar", "Romania", "Russian Federation",
  "Rwanda", "Samoa", "San Marino", "Saudi Arabia", "Senegal", "Serbia",
  "Seychelles", "Sierra Leone", "Singapore", "Sint Maarten (Dutch part)",
  "Slovak Republic", "Slovenia", "Solomon Islands", "Somalia", "South Africa",
  "South Sudan", "Spain", "Sri Lanka", "St. Kitts and Nevis", "St. Lucia",
  "St. Martin (French part)", "St. Vincent and the Grenadines", "Sudan",
  "Suriname", "Sweden", "Switzerland", "Syrian Arab Republic",
  "São Tomé and Principe", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
  "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
  "Turkmenistan", "Turks and Caicos Islands", "Tuvalu", "Türkiye", "Uganda",
  "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan", "Vanuatu", "Viet Nam", "Virgin Islands (U.S.)",
  "West Bank and Gaza", "Yemen, Rep.", "Zambia", "Zimbabwe",
];

/** Buyers from this country are charged in LKR. Everyone else pays USD. */
const LKR_COUNTRY = "Sri Lanka";

const COUNTRY_SET = new Set(COUNTRIES);

function isValidCountry(country) {
  return COUNTRY_SET.has(String(country || "").trim());
}

module.exports = { COUNTRIES, LKR_COUNTRY, isValidCountry };