import csv
import re
import time
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import Request, urlopen


LISTING_URL = (
    "https://system-kanji.com/search/system/"
    "hokkaido--aomori--akita--yamagata--iwate--miyagi--fukushima--tokyo--"
    "kanagawa--saitama--chiba--tochigi--ibaraki--gunma--aichi--gifu--"
    "shizuoka--mie--niigata--yamanashi--nagano--ishikawa--toyama--fukui--"
    "osaka--hyogo--kyoto--shiga--nara--wakayama--okayama--hiroshima--"
    "tottori--shimane--yamaguchi--kagawa--tokushima--ehime--kochi--fukuoka--"
    "saga--nagasaki--kumamoto--oita--miyazaki--kagoshima--okinawa"
)
OUTPUT_FILE = "system_kanji_companies.csv"
TOTAL_PAGES = 249
PAGE_DELAY_SECONDS = 0.15
PROFILE_WORKERS = 8


def fetch(url):
    last_error = None
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise last_error


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.in_target = False
        self.current_href = None
        self.current_text = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "a" and "services-item" in attributes.get("class", "").split():
            self.in_target = True
            self.current_href = attributes.get("href")
            self.current_text = []

    def handle_data(self, data):
        if self.in_target:
            self.current_text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_target:
            self.links.append((self.current_href, " ".join(self.current_text).strip()))
            self.in_target = False


class ProfileParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.company_info = {}
        self.current_tag = None
        self.current_label = None
        self.current_value = []
        self.in_company_info = False
        self.project_count = 0
        self.in_project = False

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = attributes.get("class", "").split()
        if tag == "title":
            self.current_tag = "title"
        if tag == "section" and "service-content-section" in classes:
            self.in_company_info = False
        if tag == "h2" and attributes.get("id") == "info":
            self.in_company_info = True
        if self.in_company_info and tag == "dt":
            self.current_tag = "label"
            self.current_value = []
        elif self.in_company_info and tag == "dd" and self.current_label:
            self.current_tag = "value"
            self.current_value = []
        if tag == "li" and "service-works-item" in classes:
            self.project_count += 1

    def handle_data(self, data):
        if self.current_tag:
            if self.current_tag == "title":
                self.title += data
            else:
                self.current_value.append(data)

    def handle_endtag(self, tag):
        if tag == "title":
            self.current_tag = None
        elif tag == "dt" and self.in_company_info:
            self.current_label = clean_text(self.current_value)
            self.current_tag = None
        elif tag == "dd" and self.in_company_info and self.current_label:
            self.company_info[self.current_label] = clean_text(self.current_value)
            self.current_label = None
            self.current_tag = None


def clean_text(parts):
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def extract_profile(url):
    parser = ProfileParser()
    parser.feed(fetch(url))
    info = parser.company_info
    return {
        "system_kanji_profile_link": url,
        "company_name": info.get("会社名", ""),
        "capital": info.get("資本金", ""),
        "establishment_year": info.get("設立", ""),
        "number_of_members": info.get("社員数", ""),
        "company_website": info.get("URL", ""),
        "location": info.get("本社所在地", ""),
        "representative": info.get("代表", ""),
        "system_kanji_project_count": str(parser.project_count),
    }


def listing_page_url(page_number):
    return LISTING_URL if page_number == 1 else f"{LISTING_URL}/page/{page_number}"


def extract_profile_urls(page_number):
    listing_parser = LinkParser()
    listing_parser.feed(fetch(listing_page_url(page_number)))
    return [urljoin(LISTING_URL, href) for href, _ in listing_parser.links]


def main():
    profile_urls = []
    for page_number in range(1, TOTAL_PAGES + 1):
        page_urls = extract_profile_urls(page_number)
        profile_urls.extend(page_urls)
        print(f"Page {page_number}/{TOTAL_PAGES}: {len(page_urls)} profile links")
        if page_number < TOTAL_PAGES:
            time.sleep(PAGE_DELAY_SECONDS)

    profile_urls = list(dict.fromkeys(profile_urls))
    print(f"Found {len(profile_urls)} unique profile links; fetching company details...")
    with ThreadPoolExecutor(max_workers=PROFILE_WORKERS) as executor:
        rows = list(executor.map(extract_profile, profile_urls))
    fieldnames = list(rows[0]) if rows else [
        "system_kanji_profile_link", "company_name", "capital",
        "establishment_year", "number_of_members", "company_website",
        "location", "representative", "system_kanji_project_count",
    ]
    with open(OUTPUT_FILE, "w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} companies to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()