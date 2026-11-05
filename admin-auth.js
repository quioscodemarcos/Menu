/* Google provider and matching database rules are deployed. */
window.ADMIN_GOOGLE_ENABLED = true;
window.FirebaseAdmin = {
  load() {
    if (!this.loading) this.loading = this.initialize().catch(error => { this.loading = null; throw error; });
    return this.loading;
  },
  async initialize() {
    for (const file of ['firebase-app-compat.js', 'firebase-auth-compat.js']) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        if (file === 'firebase-app-compat.js' && window.firebase?.initializeApp) { resolve(); return; }
        if (file === 'firebase-auth-compat.js' && window.firebase?.auth) { resolve(); return; }
        script.src = 'https://www.gstatic.com/firebasejs/9.23.0/' + file;
        script.onload = resolve; script.onerror = () => reject(new Error('No se pudo cargar el acceso con Google.'));
        document.head.appendChild(script);
      });
    }
    if (!firebase.apps.length) firebase.initializeApp({apiKey: 'AIzaSyArr-J4OkU-1vJpgm57BDIAaAPeMJR9Ijo', authDomain: 'quioscodemarcos.firebaseapp.com', projectId: 'quioscodemarcos'});
    const auth = firebase.auth();
    await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
    return auth;
  },
  async signIn() {
    const auth = await this.load();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({prompt: 'select_account'});
    const result = await auth.signInWithPopup(provider);
    if (!result.user.emailVerified) {
      await auth.signOut();
      throw new Error('La cuenta de Google debe tener el correo verificado.');
    }
    await this.verifyAdmin(result.user);
  },
  async verifyAdmin(user) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const token = await user.getIdToken();
      const response = await fetch('https://quioscodemarcos-default-rtdb.firebaseio.com/menu_admin.json?auth=' + encodeURIComponent(token), {cache:'no-store', signal:controller.signal});
      if (!response.ok || await response.json() !== true) {
        const denied = new Error('Esta cuenta no tiene permiso para editar el menú.');
        denied.code = 'menu/not-authorized';
        throw denied;
      }
    } catch (error) {
      await this.signOut();
      if (error.code === 'menu/not-authorized') throw error;
      throw new Error('No se pudo confirmar el acceso. Revisa la conexión e intenta nuevamente.');
    } finally { clearTimeout(timeout); }
  },
  async token() {
    const auth = await this.load();
    if (!auth.currentUser || !auth.currentUser.emailVerified) throw new Error('Vuelve a ingresar con tu cuenta de Google.');
    return auth.currentUser.getIdToken();
  },
  async signOut() { if (window.firebase?.auth) await firebase.auth().signOut(); }
};
