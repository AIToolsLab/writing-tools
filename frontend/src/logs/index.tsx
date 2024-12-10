import * as ReactDOM from 'react-dom';
import { useEffect, useState } from 'react';

import { SERVER_URL } from '@/api';

import classes from './styles.module.css';

interface Log {
    username: string;
    interaction: string;
    prompt: string;
    result: string;
    completion: string;
    timestamp: string;
}

function App() {
    const [logs, updateLogs] = useState<Log[]>([]);

    const [usernameFilter, updateUsernameFilter] = useState('');

    useEffect(() => {
        (async function() {
            const streamer = new EventSource(`${SERVER_URL}/logs`);
            
            streamer.onmessage = (event) => {
                const parsedLogs = JSON.parse(event.data);
        
                const newLogs = parsedLogs.map((log: {logs: Log[]}) => log.logs).flat();
                updateLogs([...logs, ...newLogs]);
            };
        })();
    }, []);

    return (
        <>
            <div className={ classes.container }>
                <input type="text" placeholder="Username" onChange={ (e) => updateUsernameFilter(e.target.value) } />
            </div>

            {
                (
                    function() {
                        const groupedLogs = logs.reduce((acc: any, log) => {
                            if (!acc[log.username]) {
                                acc[log.username] = [];
                            }
                    
                            acc[log.username].push(log);
                    
                            return acc;
                        }, {});

                        // const filteredLogs = logs.filter((log) => log.username.includes(usernameFilter));

                        return (
                            Object.keys(groupedLogs).filter(
                                username => username.includes(usernameFilter)
                            ).map(
                                username => (
                                    <div key={ username }>
                                        <h2>{ username }</h2>

                                        <ul>
                                            {
                                                groupedLogs[username].map((log: Log) => (
                                                    <li key={ log.timestamp }>
                                                        <p><strong>Interaction:</strong> { log.interaction }</p>
                                                        <p><strong>Prompt:</strong> { log.prompt }</p>
                                                        <p><strong>Result:</strong> { log.result }</p>
                                                        <p><strong>Completion:</strong> { log.completion }</p>
                                                        <p><strong>Timestamp:</strong> { log.timestamp }</p>
                                                    </li>
                                                ))
                                            }
                                        </ul>
                                    </div>
                                )
                            )
                        );
                    }()
                )
            }
        </>
    );
}

ReactDOM.render(<App />, document.getElementById('container'));
