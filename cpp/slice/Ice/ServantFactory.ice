// **********************************************************************
//
// Copyright (c) 2001
// MutableRealms, Inc.
// Huntsville, AL, USA
//
// All Rights Reserved
//
// **********************************************************************

#ifndef ICE_SERVANT_FACTORY_ICE
#define ICE_SERVANT_FACTORY_ICE

module Ice
{

/**
 *
 * A factory for Servants. Servant Factories are used in several
 * places, for example, for receiving "objects by value", for
 * unpickling Servants, and for the Freeze module. Servant Factories
 * must be implemented by the application writer, and installed with
 * the Communicator.
 *
 * @see Pickler
 *
 **/
local interface ServantFactory
{
    /**
     *
     * Create a new Servant for a given Servant type. The type is the
     * absolute Slice type name, i.e., the the name relative to the
     * unnamed top-level Slice module. For example, the absolute Slice
     * type name for Servants for interfacees of type
     * <literal>Bar</literal> in the module <literal>Foo</literal> is
     * <literal>::Foo::Bar</literal>.
     *
     * <note><para>The leading "<literal>::</literal>" is
     * required.</para></note>
     *
     * @param type The Servant type.
     *
     * @return The Servant created for the given type.
     *
     **/
    Object create(string type);

    /**
     *
     * Called when the Communicator this Servant Factory is installed
     * with is destroyed.
     *
     * @see Communicator::destroy
     *
     **/
    void destroy();
};

};

#endif
