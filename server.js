// server.js - Backend Node.js pour la gestion des candidatures VTC
// VERSION 3 - Avec persistance Google Sheets complète

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Créer le dossier uploads s'il n'existe pas
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Servir les fichiers uploadés
app.use('/uploads', express.static(uploadsDir));

// Configuration Google Sheets
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

let sheetsAPI = null;

// Cache en mémoire des candidatures (chargé depuis Google Sheets)
let candidatures = [];
let nextId = 1;

// Initialiser Google Sheets API
async function initGoogleSheets() {
  try {
    const auth = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      GOOGLE_PRIVATE_KEY,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    sheetsAPI = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API initialisée');
    
    // Charger les candidatures au démarrage
    await loadCandidaturesFromSheet();
  } catch (error) {
    console.error('❌ Erreur initialisation Google Sheets:', error);
  }
}

// FONCTION 1: Charger les candidatures depuis Google Sheets
async function loadCandidaturesFromSheet() {
  if (!sheetsAPI || !GOOGLE_SHEET_ID) {
    console.error('Google Sheets non configuré');
    return;
  }

  try {
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Candidatures!A4:H' // Ligne 3 = en-têtes, ligne 4+ = données
    });

    const rows = response.data.values || [];
    candidatures = [];
    
    rows.forEach(row => {
      if (row.length >= 7) { // Au moins ID, Nom, Email, Téléphone, Ville, Date, Statut
        const candidature = {
          id: parseInt(row[0]) || 0,
          fullName: row[1] || '',
          email: row[2] || '',
          phone: row[3] || '',
          city: row[4] || '',
          submittedDate: row[5] || new Date().toISOString(),
          status: row[6] || 'nouveau',
          declaration: row[7] === 'Oui' || row[7] === 'true',
          documents: {}, // Les documents sont perdus après redéploiement (fichiers éphémères)
          remarque: ''
        };
        
        candidatures.push(candidature);
        
        // Mettre à jour nextId
        if (candidature.id >= nextId) {
          nextId = candidature.id + 1;
        }
      }
    });

    console.log(`✅ ${candidatures.length} candidatures chargées depuis Google Sheets`);
  } catch (error) {
    console.error('❌ Erreur chargement candidatures:', error);
  }
}

// FONCTION 2: Sauvegarder une nouvelle candidature dans Google Sheets
async function saveCandidatureToSheet(candidature) {
  if (!sheetsAPI || !GOOGLE_SHEET_ID) {
    console.error('Google Sheets non configuré');
    return;
  }

  try {
    const row = [
      candidature.id,
      candidature.fullName,
      candidature.email,
      candidature.phone,
      candidature.city,
      new Date(candidature.submittedDate).toLocaleDateString('fr-FR'),
      candidature.status,
      candidature.declaration ? 'Oui' : 'Non'
    ];

    await sheetsAPI.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Candidatures!A4:H',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [row]
      }
    });

    console.log(`✅ Candidature #${candidature.id} (${candidature.fullName}) sauvegardée dans Google Sheets`);
  } catch (error) {
    console.error('❌ Erreur sauvegarde candidature:', error);
  }
}

// FONCTION 3: Mettre à jour le statut d'une candidature dans Google Sheets
async function updateCandidatureStatusInSheet(candidature) {
  if (!sheetsAPI || !GOOGLE_SHEET_ID) {
    console.error('Google Sheets non configuré');
    return;
  }

  try {
    // Trouver la ligne correspondante (ligne 4 = première donnée)
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Candidatures!A4:A' // Colonne ID uniquement
    });

    const ids = response.data.values || [];
    let rowIndex = -1;
    
    for (let i = 0; i < ids.length; i++) {
      if (parseInt(ids[i][0]) === candidature.id) {
        rowIndex = i + 4; // +4 car ligne 4 = première donnée
        break;
      }
    }

    if (rowIndex === -1) {
      console.error(`❌ Candidature #${candidature.id} non trouvée dans Google Sheets`);
      return;
    }

    // Mettre à jour le statut (colonne G)
    await sheetsAPI.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `Candidatures!G${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[candidature.status]]
      }
    });

    console.log(`✅ Statut candidature #${candidature.id} mis à jour: ${candidature.status}`);
  } catch (error) {
    console.error('❌ Erreur mise à jour statut:', error);
  }
}

// FONCTION 4: Ajouter un chauffeur dans l'onglet "Rattachement"
async function addDriverToRattachement(candidature) {
  if (!sheetsAPI || !GOOGLE_SHEET_ID) {
    console.error('Google Sheets non configuré');
    return;
  }

  try {
    const row = [
      candidature.fullName,
      candidature.email,
      candidature.phone,
      candidature.city,
      'RIB à fournir', // Le RIB sera ajouté manuellement
      new Date().toLocaleDateString('fr-FR'),
      'accepte'
    ];

    await sheetsAPI.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Rattachement!A2:G', // Ligne 1 = en-têtes, ligne 2+ = données
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [row]
      }
    });

    console.log(`✅ Chauffeur ${candidature.fullName} ajouté à l'onglet Rattachement`);
  } catch (error) {
    console.error('❌ Erreur ajout Rattachement:', error);
  }
}

// Initialiser Google Sheets au démarrage
initGoogleSheets();

// Configuration du stockage des fichiers sur disque
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max
});

// Fonction pour envoyer un email via l'API Brevo (REST)
async function sendEmailViaBrevoAPI(to, subject, htmlContent, attachments = []) {
  const payload = {
    sender: { email: process.env.EMAIL_FROM || 'noreply@votreentreprise.fr', name: 'VTC Candidatures' },
    to: [{ email: to }],
    subject: subject,
    htmlContent: htmlContent
  };

  // Ajouter les pièces jointes seulement s'il y en a
  if (attachments && attachments.length > 0) {
    payload.attachment = attachments.map(att => ({
      name: att.filename,
      content: att.content.toString('base64')
    }));
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API error: ${response.status} ${errorText}`);
    }

    console.log('✅ Email envoyé via Brevo API');
  } catch (error) {
    console.error('❌ Erreur envoi email Brevo:', error);
    throw error;
  }
}

// Route pour soumettre une candidature
app.post('/api/candidatures', upload.fields([
  { name: 'carteIdentite', maxCount: 2 },
  { name: 'carteVitale', maxCount: 1 },
  { name: 'permis', maxCount: 2 },
  { name: 'carteVTC', maxCount: 2 },
  { name: 'carteGrise', maxCount: 1 },
  { name: 'photoVehicule', maxCount: 1 },
  { name: 'memoAssurance', maxCount: 1 },
  { name: 'attestationTitreOnereuse', maxCount: 1 },
  { name: 'justificatifDomicile', maxCount: 1 },
  { name: 'rib', maxCount: 1 }
]), async (req, res) => {
  try {
    const { fullName, email, phone, city, declaration, remarque } = req.body;
    
    // Préparer les pièces jointes et stocker les infos
    const attachments = [];
    const documents = {};
    
    Object.keys(req.files).forEach(fieldName => {
      documents[fieldName] = [];
      req.files[fieldName].forEach(file => {
        // Lire le fichier depuis le disque pour l'email
        const fileBuffer = fs.readFileSync(file.path);
        
        attachments.push({
          filename: file.originalname,
          content: fileBuffer
        });
        
        documents[fieldName].push({
          name: file.originalname,
          path: file.path,
          downloadUrl: `/uploads/${file.filename}` // URL de téléchargement
        });
      });
    });

    const candidature = {
      id: nextId++,
      fullName,
      email,
      phone,
      city,
      declaration,
      remarque,
      documents,
      status: 'nouveau',
      submittedDate: new Date().toISOString()
    };
    
    candidatures.push(candidature);
    
    // Sauvegarder dans Google Sheets
    await saveCandidatureToSheet(candidature);

    // Email à l'admin avec tous les documents
    const adminMailOptions = {
      from: process.env.EMAIL_FROM || 'candidatures@votreentreprise.fr',
      to: process.env.EMAIL_ADMIN || 'votre-email@gmail.com',
      subject: `🚗 Nouvelle candidature chauffeur : ${fullName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Arial', sans-serif; background: #fafaf8; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #C9A961 0%, #B89751 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 30px; }
            .info-row { margin: 15px 0; padding: 15px; background: #f5f5f3; border-radius: 4px; }
            .label { font-size: 12px; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
            .value { font-size: 15px; color: #1a1a1a; font-weight: 500; }
            .documents { margin-top: 20px; padding: 20px; background: #f5f5f3; border-radius: 4px; }
            .doc-item { margin: 8px 0; color: #1a1a1a; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 28px; font-weight: 300;">Nouvelle Candidature</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Chauffeur VTC</p>
            </div>
            <div class="content">
              <div class="info-row">
                <div class="label">Nom complet</div>
                <div class="value">${fullName}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Email</div>
                <div class="value">${email}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Téléphone</div>
                <div class="value">${phone}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Ville</div>
                <div class="value">${city}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Déclaration URSSAF</div>
                <div class="value">${declaration ? 'Oui ✅' : 'Non ❌'}</div>
              </div>
              
              ${remarque ? `
              <div class="info-row">
                <div class="label">Remarque</div>
                <div class="value">${remarque}</div>
              </div>
              ` : ''}
              
              <div class="documents">
                <div class="label" style="margin-bottom: 10px;">Documents joints (${attachments.length})</div>
                ${Object.keys(documents).map(docType => 
                  `<div class="doc-item">✓ ${docType}: ${documents[docType].length} fichier(s)</div>`
                ).join('')}
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Email au candidat
    const candidatMailOptions = {
      from: process.env.EMAIL_FROM || 'candidatures@votreentreprise.fr',
      to: email,
      subject: 'Candidature reçue - Chauffeur VTC',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Arial', sans-serif; background: #fafaf8; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #C9A961 0%, #B89751 100%); color: white; padding: 40px 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .check { width: 60px; height: 60px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="check">✓</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 300;">Candidature reçue</h1>
            </div>
            <div class="content">
              <p style="font-size: 16px; color: #1a1a1a; line-height: 1.6;">
                Bonjour <strong>${fullName}</strong>,
              </p>
              <p style="font-size: 16px; color: #1a1a1a; line-height: 1.6;">
                Nous avons bien reçu votre candidature pour un poste de chauffeur VTC. 
                Tous vos documents ont été enregistrés avec succès.
              </p>
              <p style="font-size: 16px; color: #1a1a1a; line-height: 1.6;">
                Notre équipe va étudier votre dossier et nous reviendrons vers vous dans les plus brefs délais.
              </p>
              <p style="font-size: 14px; color: #6b6b6b; margin-top: 30px; line-height: 1.6;">
                Cordialement,<br>
                L'équipe de recrutement
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Envoyer les emails via l'API Brevo
    await sendEmailViaBrevoAPI(
      process.env.EMAIL_ADMIN || 'votre-email@gmail.com',
      `🚗 Nouvelle candidature chauffeur : ${fullName}`,
      adminMailOptions.html,
      attachments
    );

    await sendEmailViaBrevoAPI(
      email,
      'Candidature reçue - Chauffeur VTC',
      candidatMailOptions.html
    );

    res.json({ 
      success: true, 
      message: 'Candidature envoyée avec succès',
      id: candidature.id
    });

  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de l\'envoi de la candidature' 
    });
  }
});

// Route pour récupérer toutes les candidatures
app.get('/api/candidatures', (req, res) => {
  res.json(candidatures);
});

// Route pour mettre à jour le statut d'une candidature
app.patch('/api/candidatures/:id/status', async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  
  const candidature = candidatures.find(c => c.id === id);
  if (candidature) {
    const oldStatus = candidature.status;
    candidature.status = status;
    
    // Mettre à jour dans Google Sheets
    await updateCandidatureStatusInSheet(candidature);
    
    // Si le statut passe à "accepte", ajouter au Rattachement
    if (status === 'accepte' && oldStatus !== 'accepte') {
      await addDriverToRattachement(candidature);
    }
    
    res.json({ success: true, candidature });
  } else {
    res.status(404).json({ success: false, error: 'Candidature non trouvée' });
  }
});

// Route pour envoyer un email personnalisé à un candidat
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    
    await sendEmailViaBrevoAPI(to, subject, message);
    
    res.json({ success: true, message: 'Email envoyé avec succès' });
  } catch (error) {
    console.error('Erreur envoi email:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'envoi de l\'email' });
  }
});

// Route pour sauvegarder les paiements hebdomadaires dans Google Sheets
app.post('/api/save-payments', async (req, res) => {
  try {
    const { week, drivers } = req.body;
    
    if (!sheetsAPI || !GOOGLE_SHEET_ID) {
      return res.status(500).json({ success: false, error: 'Google Sheets non configuré' });
    }

    // Préparer les lignes à insérer
    const rows = drivers.map(driver => [
      week,
      driver.chauffeur,
      driver.uber,
      driver.bolt,
      driver.total,
      driver.commission,
      driver.dette,
      driver.aReverser,
      driver.nouvelleDette
    ]);

    // Ajouter dans l'onglet "Historique Paiements"
    await sheetsAPI.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Historique Paiements!A2:I', // Ligne 1 = en-têtes, ligne 2+ = données
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: rows
      }
    });

    console.log(`✅ Paiements semaine ${week} sauvegardés (${drivers.length} chauffeurs)`);
    
    res.json({ success: true, message: 'Paiements sauvegardés avec succès' });
  } catch (error) {
    console.error('❌ Erreur sauvegarde paiements:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la sauvegarde' });
  }
});

// Route de health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    candidatures: candidatures.length,
    sheetsConnected: sheetsAPI !== null
  });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📊 ${candidatures.length} candidatures en mémoire`);
});
