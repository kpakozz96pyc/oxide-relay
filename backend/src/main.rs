use std::net::SocketAddr;

use oxiderelay_backend::{
    app::AppState,
    config::{Command, Settings},
    db::{initialize as initialize_database, initialize_existing},
    http, recovery,
};
use tokio::net::TcpListener;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (settings, command) = Settings::load()?;

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "oxiderelay_backend=info,tower_http=info".to_owned()),
        )
        .with_target(false)
        .compact()
        .init();

    if let Some(Command::PasswordResetLink { email }) = command {
        let pool = initialize_existing(&settings).await?;
        let reset_link = recovery::generate_password_reset_link(&pool, &email).await?;

        println!("Password reset URL: {}", reset_link.reset_url);
        println!("Expires at: {}", reset_link.expires_at);
        pool.close().await;
        return Ok(());
    }

    let pool = initialize_database(&settings).await?;
    let app = http::router(
        AppState::new(pool, settings.session.clone(), settings.delivery.clone()),
        settings.frontend.dist_path.clone(),
    );
    let address: SocketAddr = settings.server.socket_addr()?;
    let listener = TcpListener::bind(address).await?;

    info!("starting backend on {}", address);
    info!("sqlite database path: {}", settings.database.path.display());
    info!(
        frontend_dist_path = %settings.frontend.dist_path.display(),
        frontend_present = settings.frontend.dist_path.join("index.html").is_file(),
        "frontend static configuration loaded"
    );
    info!(
        bootstrap_admin_configured = settings.bootstrap_admin.is_configured(),
        "bootstrap admin configuration loaded"
    );
    info!(
        public_delivery_enabled = settings.delivery.public_enabled,
        delivery_token_configured = settings.delivery.token.is_some(),
        "delivery security configuration loaded"
    );

    axum::serve(listener, app).await?;

    Ok(())
}
