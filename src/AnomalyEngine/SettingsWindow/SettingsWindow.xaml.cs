using System.Windows;
using System.Windows.Controls;

namespace AnomalyEngine.SettingsWindow;

public partial class SettingsWindow : Window
{
    public SettingsWindow()
    {
        InitializeComponent();
    }

    private void ShowSection(string sectionName)
    {
        SectionTitle.Text = sectionName;
        HomeSection.Visibility = Visibility.Collapsed;
        WorldsSection.Visibility = Visibility.Collapsed;
        PerformanceSection.Visibility = Visibility.Collapsed;
        EventsSection.Visibility = Visibility.Collapsed;
        IntegrationsSection.Visibility = Visibility.Collapsed;
        SecretsSection.Visibility = Visibility.Collapsed;
        AboutSection.Visibility = Visibility.Collapsed;

        switch (sectionName)
        {
            case "Home": HomeSection.Visibility = Visibility.Visible; break;
            case "Worlds": WorldsSection.Visibility = Visibility.Visible; break;
            case "Performance": PerformanceSection.Visibility = Visibility.Visible; break;
            case "Events": EventsSection.Visibility = Visibility.Visible; break;
            case "Integrations": IntegrationsSection.Visibility = Visibility.Visible; break;
            case "Secrets": SecretsSection.Visibility = Visibility.Visible; break;
            case "About": AboutSection.Visibility = Visibility.Visible; break;
        }
    }

    private void BtnHome_Click(object sender, RoutedEventArgs e) => ShowSection("Home");
    private void BtnWorlds_Click(object sender, RoutedEventArgs e) => ShowSection("Worlds");
    private void BtnAppearance_Click(object sender, RoutedEventArgs e) => ShowSection("Appearance");
    private void BtnPerformance_Click(object sender, RoutedEventArgs e) => ShowSection("Performance");
    private void BtnEvents_Click(object sender, RoutedEventArgs e) => ShowSection("Events");
    private void BtnAudio_Click(object sender, RoutedEventArgs e) => ShowSection("Audio");
    private void BtnMonitors_Click(object sender, RoutedEventArgs e) => ShowSection("Monitors");
    private void BtnIntegrations_Click(object sender, RoutedEventArgs e) => ShowSection("Integrations");
    private void BtnSecrets_Click(object sender, RoutedEventArgs e) => ShowSection("Secrets");
    private void BtnAbout_Click(object sender, RoutedEventArgs e) => ShowSection("About");

    private void BtnPause_Click(object sender, RoutedEventArgs e) { }
    private void BtnResume_Click(object sender, RoutedEventArgs e) { }
    private void BtnNextWorld_Click(object sender, RoutedEventArgs e) { }
    private void BtnTriggerEvent_Click(object sender, RoutedEventArgs e) { }
    private void BtnActivateWorld_Click(object sender, RoutedEventArgs e) { }
    private void BtnPreviewWorld_Click(object sender, RoutedEventArgs e) { }
    private void BtnDeleteWorld_Click(object sender, RoutedEventArgs e) { }
    private void BtnImportWorld_Click(object sender, RoutedEventArgs e) { }
    private void BtnOpenFolder_Click(object sender, RoutedEventArgs e) { }
}
