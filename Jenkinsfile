pipeline {
    agent { docker compose: 'docker-compose.yml' }
    stages {
        stage('Build') {
            steps {
                echo 'Building the application...'
                sh 'docker-compose build'
            }
        }
        // stage('Test') {
        //     steps {
        //         echo 'Running tests...'
        //         sh 'docker-compose run backend pytest'
        //     }
        // }
        // stage('Lint') {
        //     steps {
        //         echo 'Running linters...'
        //         sh 'docker-compose run backend flake8 backend'
        //     }
        // }
        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                echo 'Deploying the application...'
                sh 'docker-compose up -d'
            }
        }
    }
}