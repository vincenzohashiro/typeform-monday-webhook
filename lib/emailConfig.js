const BLOB = "https://jfuzxndjys5a6pyj.private.blob.vercel-storage.com";

export const BOARD_EMAIL_CONFIG = {
  "5052697723": {
    emailColumnId:  "email_mkwx219b",
    statusColumnId: "color_mm2fb1sj",
    triggers: {
      "Email 1 sendt": "email1",
      "Email 2 sendt": "email2",
    },
  },
  "5089650058": {
    emailColumnId:  "email_mkza7v62",
    statusColumnId: "color_mkzbweje",
    triggers: {
      "Email 1 sendt": "email1",
      "Email 2 sendt": "email2",
      "Email 3 sendt": "email3",
    },
  },
};

export const EMAIL_CONFIG = {
  email1: {
    subject: "Information om dit forløb hos Håreksperten",
    attachments: [
      { url: `${BLOB}/1.%20Pakkeindhold%20og%20dit%20forl%C3%B8b.pdf`,        filename: "1. Pakkeindhold og dit forløb.pdf" },
      { url: `${BLOB}/2.%20F%C3%B8r%20og%20efter%20operationen.pdf`,           filename: "2. Før og efter operationen.pdf" },
      { url: `${BLOB}/3.%20Flyinformationer%20og%20oplysninger.pdf`,           filename: "3. Flyinformationer og oplysninger.pdf" },
    ],
    body: (name) => `Kære ${name}

Tak for din interesse i Håreksperten.

For at give dig et klart og trygt overblik over forløbet har vi vedhæftet tre dokumenter med al relevant information. Vi anbefaler, at du læser materialet grundigt igennem, så du føler dig velinformeret, før du træffer din beslutning.

Du finder følgende vedhæftede filer:
• Pakkeindhold og dit forløb
• Før og efter operation
• Flyinformationer og oplysninger

Hotelinformation
Du vil blive indkvarteret på et sundhedshotel i gåafstand til klinikken. Hotellet er nøje udvalgt med fokus på komfort, kvalitet og den praktiske beliggenhed i forbindelse med behandlingen.

Ønsker du et indblik i klinikken og andres oplevelser, kan du følge hele processen i vores præsentationsvideo her:
https://www.youtube.com/watch?v=ynX_yLo6Tmk&t

Skuespiller og filminstruktør Tomas Villum Jensen deler desuden sin personlige rejse til Istanbul og sine tanker om hårtab her:
https://www.youtube.com/watch?v=mshMEZ0BeRc&feature=youtu.be

I programmet Størst på TV2 Play med Peter Ingemann kan du møde vores klient Carsten, som gennemgår en hårtransplantation og deler sin inspirerende historie:
https://play.tv2.dk/serie/stoerst-tv2/6/europas-stoerste-by-d294eabc-974d-4518-8b53-a6109e323218#

Tryghed & opfølgning
Vores støtte stopper ikke efter operationen. Vi følger dig gennem hele hårvækstperioden og står til rådighed ved faglige spørgsmål vedr. din hårtransplantation. Efter din operation kan du altid kontakte os på support@haareksperten.com.

Vi samarbejder desuden med klinikker i København og Aarhus, hvor det er muligt at få foretaget PRP/PRF behandling som supplement. Se gerne vores PRF/PRP præsentationsvideo her:
https://haareksperten.com/resultater/

Med venlig hilsen
Håreksperten`,
  },

  email2: {
    subject: "",
    attachments: [],
    body: (name) => `Kære ${name}\n\n`,
  },

  email3: {
    subject: "",
    attachments: [],
    body: (name) => `Kære ${name}\n\n`,
  },

  email4: {
    subject: "",
    attachments: [],
    body: (name) => `Kære ${name}\n\n`,
  },
};
