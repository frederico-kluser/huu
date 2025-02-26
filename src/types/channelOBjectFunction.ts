import CommunicationChannel from "./communicationChannel";

type TypeChannelObjectFunction = {
    [key in CommunicationChannel]: (...args: any[]) => void;
};

export default TypeChannelObjectFunction;